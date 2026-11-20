"""
Conversation layer for knowledge-base answers (used when no AI model is
configured). Keeps per-call state so a call or chat behaves like a
conversation instead of independent keyword lookups:

- the role being discussed is remembered, so "what are the requirements"
  after "I'm a nurse" answers about the Nurse role;
- statements are understood: "I'm looking for a job" lists the roles,
  "I'm a chef" introduces the Chef role and offers next steps;
- the role's "Candidate Screening Questions" are asked one at a time and
  the caller's answers are kept with the call;
- "yes", "tell me more" and "what else" continue from the last answer;
- the agent never sends the same reply twice in a row;
- it answers in the visitor's language (English, Urdu, Roman Urdu), follows
  "chat in Urdu"-style requests, and handles small talk, gibberish and
  off-topic questions by steering back to the company's hiring campaign,
  with varied wording instead of one fixed fallback (chat_language.py).
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from app.services import chat_language as lang
from app.services.knowledge import KnowledgeBase, key_words

_QUESTION_START = {
    "what", "how", "can", "could", "do", "does", "did", "is", "are", "which",
    "who", "where", "when", "why", "will", "would", "should", "tell", "explain",
    "any", "may", "have", "has",
}
_YES = {"yes", "yeah", "yep", "yup", "sure", "ok", "okay", "please", "alright", "definitely", "absolutely", "go", "ahead", "start", "proceed",
        # Roman Urdu / Urdu
        "haan", "han", "hanji", "ji", "jee", "bilkul", "zaroor", "zarur", "theek", "thik", "acha", "achha", "accha", "kar", "karo", "karein",
        "جی", "ہاں", "بالکل", "ضرور", "ٹھیک"}
_NO = {"no", "nope", "nah", "not", "later", "stop", "cancel",
       "nahi", "nahin", "nai", "nhi", "mat", "rehne", "نہیں", "نہی"}
_MORE = re.compile(r"\b(tell me more|more (info|information|details)|go on|what else|anything else|continue|carry on)\b", re.I)
_NEXT_STEP = re.compile(r"\b(next step|what (should|do|can) i do( now| next)?|how (do|can|should) i (start|proceed|go ahead)|what now|"
                        r"help me (apply|get started|with (the|my) application))\b", re.I)
# A question about pay must be answered with pay; the nearest passage
# ("Candidate Information Required: ...") isn't an answer.
_ASPECTS = {
    "pay": (re.compile(r"\b(salary|salaries|pay|paid|wage|wages|rate|earn|money|package|compensation|how much)\b", re.I),
            re.compile(r"\b(salary|salaries|pay|paid|wage|wages|per (hour|annum|year|month|week))\b|[£$€]\s?\d|"
                       r"\b\d[\d,.]*\s?(k|pounds|gbp|pkr|rs|rupees)\b", re.I)),
}
# A question about a detail of the job (for "our recruiter will confirm
# that for the X role"); anything else gets the general fallback.
_JOB_DETAIL = re.compile(r"\b(salary|pay|wage|hours|shift|shifts|location|where|requirement\w*|experience|visa|"
                         r"sponsor\w*|holiday\w*|leave|start|contract|benefit\w*|training|uniform|interview|"
                         r"overtime|bonus|pension|accommodation|transport)\b", re.I)
# The caller telling us about themselves (experience, qualifications).
_SELF_INFO = re.compile(r"\b(\d+|year|years|experience|experienced|qualified|qualification|certificate|degree|"
                        r"worked|working|currently|licen[cs]e|registered|nmc|pin)\b", re.I)
# "I have 5 years experience", "I'm RGN qualified", "my last job was ...":
# the caller telling us about themselves.
_ABOUT_ME = re.compile(r"^\s*(i|i'm|im|i've|ive|i am|i have|my)\b", re.I)
_JOB_SEEKING = re.compile(r"\b(looking for|search(ing)? for|find|need|want|seeking|interested in|apply(ing)? for)\b.*\b(job|jobs|work|role|roles|position|positions|vacanc(y|ies)|employment|opportunit(y|ies))\b"
                          r"|\b(any|your) (jobs|vacancies|roles|positions|openings)\b", re.I)
_DETAILS = re.compile(r"\b(apply|application|register|sign me up|take my details|my details|interested)\b", re.I)


@dataclass
class CallState:
    topic: Optional[str] = None          # role being discussed, e.g. "Nurse"
    offered: Optional[str] = None        # what the last reply offered: "details" or "role"
    screening: list = field(default_factory=list)   # screening questions still to ask
    asking: Optional[str] = None         # the screening question awaiting an answer
    answers: dict = field(default_factory=dict)      # screening question -> caller's answer
    last_ref: Optional[tuple] = None     # section last answered from (for "tell me more")
    last_reply: str = ""
    fallbacks: int = 0
    language: str = "english"            # english / urdu / roman_urdu
    lang_locked: bool = False            # the visitor asked for this language
    turns: int = 0                       # rotates the wording of repeated situations


def _words(text: str) -> list:
    # Latin words, and Urdu-script words (for "جی" / "نہیں").
    return re.findall(r"[a-z']+|[؀-ۿ]+", (text or "").lower())


def is_question(text: str) -> bool:
    w = _words(text)
    return "?" in text or (bool(w) and w[0] in _QUESTION_START)


def is_yes(text: str) -> bool:
    w = _words(text)
    return bool(w) and len(w) <= 5 and bool(set(w) & _YES) and not set(w) & {"no", "not", "nahi", "nahin", "nhi", "nai"}


def is_no(text: str) -> bool:
    w = _words(text)
    return bool(w) and len(w) <= 4 and bool(set(w) & _NO)


class Conversation:
    """One caller turn, answered from the knowledge base with the call's
    state. `lookup(message, topic)` is the agent's knowledge lookup and
    returns (answer, intent, ref) or None."""

    def __init__(self, kb: KnowledgeBase, state: CallState, lookup, contact: str = "",
                 company: str = "", agent: str = "", farewell: str = "",
                 allowed: Optional[list] = None, default_lang: str = "english", medium: str = "chat"):
        self.kb = kb
        self.state = state
        self.lookup = lookup
        self.contact = contact
        self.company = company
        self.agent = agent
        self.farewell = farewell
        self._in_language = False      # the reply was written in the visitor's language
        self._last_message = ""
        # Settings > Agent > Languages: the languages this conversation may use.
        self.allowed = [x for x in (allowed or [lang.ENGLISH, lang.URDU, lang.ROMAN]) if x in lang.SUPPORTED] or [lang.ENGLISH]
        self.default_lang = default_lang if default_lang in self.allowed else self.allowed[0]
        self.medium = medium

    def reply(self, message: str) -> tuple:
        st = self.state
        if st.turns == 0 or st.language not in self.allowed:
            st.language = self.default_lang
        st.turns += 1
        self._in_language = False
        self._last_message = lang.gloss(message)
        text, intent = self._language_turn(message) or \
            self._reply(lang.gloss(message) if st.language != lang.ENGLISH else message)
        if not self._in_language and st.language != lang.ENGLISH:
            text = self._in_visitors_language(text) or lang.localize(st.language, text, st.turns)
        # Never the same reply twice in a row.
        if text == st.last_reply:
            text, intent = self._fallback(repeat=True), "other"
        st.last_reply = text
        return text, intent

    # ---- language, small talk, gibberish, off-topic ----

    def _say(self, key: str, **extra) -> str:
        self._in_language = True
        return lang.phrase(self.state.language, key, self.state.turns, roles=self.kb.roles(),
                           company=self.company, agent=self.agent, contact=self.contact, allowed=self.allowed, **extra)

    def _language_turn(self, message: str) -> Optional[tuple]:
        """A reply that doesn't come from the knowledge base: a language
        change, a greeting, thanks, gibberish or an off-topic question.
        Also notes the language the visitor is writing in."""
        st = self.state
        asked = lang.requested(message)
        if asked and asked in self.allowed:
            st.language, st.lang_locked = asked, True
            return self._say("switched"), "other"
        refused = self.guard(message)
        if refused:
            return refused
        written = lang.detect(message)
        if written in (lang.URDU, lang.ROMAN) and not (st.lang_locked and st.language != lang.ENGLISH):
            st.language = written
        elif written == lang.ENGLISH and lang.ENGLISH in self.allowed and st.language != lang.ENGLISH \
                and not st.lang_locked and len(lang.words(message)) >= 4:
            st.language = lang.ENGLISH
        elif written == "other":
            return self._say(refuse, asked=lang.lang_name(st.language, "that language")), "other"
        if lang.is_gibberish(message):
            return self._say("gibberish"), "other"
        if st.asking:
            return None                    # a screening answer: handled below
        w = set(lang.words(message))
        if re.search(r"\b(salam|salaam|assalam\w*|asalam\w*|aoa)\b", message.lower()) or "السلام" in message:
            return self._say("greet_salam"), "other"
        if w & {"bye", "goodbye", "khuda", "hafiz", "allah"} and len(w) <= 5:
            if st.language == lang.ENGLISH and self.farewell:
                self._in_language = True
                return self.farewell, "other"
            return self._say("thanks"), "other"
        if w & {"thanks", "thank", "shukriya", "shukria", "cheers"} and len(w) <= 5 and not is_question(message):
            return self._say("thanks"), "other"
        if w & {"hello", "hi", "hey", "hiya", "morning", "afternoon", "evening"} and len(w) <= 4 \
                and not self.kb.find_role(message):
            return self._say("greet"), "other"
        if lang.is_off_topic(message) and not self.kb.find_role(message):
            return self._say("off_topic"), "other"
        if st.language != lang.ENGLISH and lang.asks_roles(message) and not self.kb.find_role(lang.gloss(message)):
            st.offered = "role"
            return self._say("only_pitch"), "general_inquiry"
        return None

    def guard(self, message: str) -> Optional[tuple]:
        """Guardrail (Settings > Agent > Languages): a reply when the message
        asks for, or is written in, a language that isn't selected; None
        when it's fine. The reply is in an allowed language and lists them."""
        st = self.state
        if st.language not in self.allowed:
            st.language = self.default_lang
        refuse = "unsupported_call" if self.medium == "call" else "unsupported"
        asked = lang.requested(message)
        if asked and asked not in self.allowed:
            return self._say(refuse, asked=lang.lang_name(st.language, asked)), "other"
        if asked:
            return None
        written = lang.detect(message)
        if written in (lang.ENGLISH, lang.URDU, lang.ROMAN) and written not in self.allowed \
                and (written != lang.ENGLISH or len(lang.words(message)) >= 3):
            return self._say("not_allowed" if self.medium == "chat" else refuse,
                             asked=lang.lang_name(st.language, written)), "other"
        if written == "other":
            return self._say(refuse, asked=lang.lang_name(st.language, "that language")), "other"
        return None

    # The agent's own fixed lines, said in the visitor's language.
    _CANNED = [
        (re.compile(r"^Thank you for sharing that\. Would you like me to take a few details for the (?P<topic>.+) role\?$"), "details_offer"),
        (re.compile(r"^No problem, I've stopped the questions"), "stopped"),
        (re.compile(r"^No problem\. Is there anything else I can help you with\?$"), "anything_else"),
        (re.compile(r"^Great\. What would you like to know\?"), "what_else"),
        (re.compile(r"^Which role are you interested in\?"), "only_pitch"),
        (re.compile(r"^Great, I'll ask you a few short questions for the (?P<topic>.+?) role\. (?P<question>.+)$"), "screening_start"),
        (re.compile(r"^Thank you\. (?P<question>[^.!]+\?)$"), "screening_next"),
    ]

    def _in_visitors_language(self, text: str) -> Optional[str]:
        for pat, key in self._CANNED:
            m = pat.search(text)
            if m:
                g = m.groupdict()
                return self._say(key, topic=g.get("topic") or self.state.topic, question=g.get("question") or "")
        return None

    # ---- turn handling ----

    def _reply(self, message: str) -> tuple:
        st = self.state
        role = self.kb.find_role(message)

        # 1) Screening in progress: the caller's turn answers the question.
        if st.asking:
            if is_no(message) and set(_words(message)) & {"stop", "cancel"}:
                self._stop_screening()
                return "No problem, I've stopped the questions. What else would you like to know?", "other"
            if _NEXT_STEP.search(message):
                left = len(st.screening) + 1
                return (f"Let's finish your application first, there {'is' if left == 1 else 'are'} "
                        f"{left} question{'' if left == 1 else 's'} left. {st.asking}"), "general_inquiry"
            if is_question(message) and not is_yes(message):
                # A question in the middle: answer it, then return to the form.
                found = self.lookup(message, st.topic)
                answer = found[0] if found else self._fallback()
                return f"{answer} Now, back to your application: {st.asking}", "general_inquiry"
            st.answers[st.asking] = message.strip()
            return self._next_screening_question(ack=True)

        # 2) "Yes" to an offer.
        if is_yes(message) and not role:
            if st.offered == "details" and st.topic:
                return self._start_screening()
            if st.offered == "role":
                return "Which role are you interested in? " + self._roles_sentence(), "general_inquiry"
            more = self._more()
            if more:
                return more
            return "Great. What would you like to know? " + self._suggestions(), "other"
        if is_no(message) and not role and st.offered:
            st.offered = None
            return "No problem. Is there anything else I can help you with?", "other"

        # 3) "Tell me more" continues from the last answer.
        if _MORE.search(message) and not role and len(key_words(message) - {"more", "info", "information", "detail"}) <= 1:
            more = self._more()
            if more:
                return more

        # 4) A role is named: remember it.
        if role:
            st.topic = role
            if _DETAILS.search(message) and not is_question(message) and self.kb.screening_questions(role):
                return self._start_screening()
            # "I'm a nurse", "what about chef", "tell me about the nurse role":
            # introduce the role and offer the next steps. A specific
            # question ("nurse requirements") is answered directly below.
            if _ABOUT_ME.search(message) and _SELF_INFO.search(message) and not is_question(message) \
                    and self.kb.screening_questions(role):
                st.offered = "details"
                return (f"Thank you for sharing that. Would you like me to take a few details "
                        f"for the {role} role?"), "general_inquiry"
            aspect = key_words(message) - key_words(role) - {"job", "about", "interested", "looking", "apply", "role", "experienced", "qualified"}
            asks_detail = bool(_JOB_DETAIL.search(message) or re.search(r"\b(responsibilit\w*|dut(y|ies)|qualification\w*|skills?)\b", message, re.I))
            if not aspect or (not is_question(message) and len(aspect) <= 1 and not asks_detail):
                return self._introduce_role(role)

        # "What should I do next?": the next step for this caller.
        if _NEXT_STEP.search(message) and not role:
            if st.topic and self.kb.screening_questions(st.topic):
                st.offered = "details"
                return (f"The next step is a few short questions about your experience for the {st.topic} role, "
                        "and then submitting your updated CV. Shall I start the questions now?"), "general_inquiry"
            found = self.lookup("how can I apply for a job", None)
            if found and not st.topic:
                st.offered = "role"
                return found[0] + " Which role are you interested in?", "general_inquiry"

        # The caller telling us about themselves while a role is being
        # discussed: offer to take their details instead of searching.
        if st.topic and _ABOUT_ME.search(message) and not is_question(message) \
                and not _JOB_SEEKING.search(message) and self.kb.screening_questions(st.topic):
            st.offered = "details"
            return (f"Thank you for sharing that. Would you like me to take a few details "
                    f"for the {st.topic} role?"), "general_inquiry"

        # 5) Looking for work without naming a role.
        if not role and _JOB_SEEKING.search(message) and not st.topic:
            roles = self.kb.roles()
            if roles:
                st.offered = "role"
                if st.language != lang.ENGLISH:
                    return self._say("only_pitch"), "general_inquiry"
                return (f"We currently recruit for {self._join(roles)} positions. "
                        "Which role are you interested in?"), "general_inquiry"

        # 6) The knowledge base.
        found = self.lookup(message, st.topic)
        if found:
            for asks, answers in _ASPECTS.values():
                if asks.search(message) and not answers.search(found[0]):
                    found = None          # it doesn't answer what was asked
                    break
        if found:
            answer, intent, ref = found
            if ref:
                st.last_ref = ref
            st.offered = None
            st.fallbacks = 0
            return answer, intent

        # 7) A statement about the caller while a role is being discussed
        # ("I have 5 years experience"): offer to take their details.
        if st.topic and not is_question(message) and self.kb.screening_questions(st.topic) \
                and (_ABOUT_ME.search(message) or _SELF_INFO.search(message)):
            st.offered = "details"
            return (f"Thank you for sharing that. Would you like me to take a few details "
                    f"for the {st.topic} role?"), "general_inquiry"

        return self._fallback(), "other"

    # ---- pieces ----

    def _introduce_role(self, role: str) -> tuple:
        st = self.state
        intro = self.kb.role_intro(role) or f"We recruit for {role} positions."
        st.last_ref = (role, (self.kb._doc_intro(role).heading if self.kb._doc_intro(role) else ""))
        if self.kb.screening_questions(role):
            st.offered = "details"
            follow = (f" Would you like to hear the requirements or the main responsibilities, "
                      f"or shall I take a few details for your {role} application?")
        else:
            st.offered = None
            follow = " Would you like to hear the requirements or the main responsibilities?"
        return intro + follow, "general_inquiry"

    def _start_screening(self) -> tuple:
        st = self.state
        st.screening = list(self.kb.screening_questions(st.topic))
        st.answers = {}
        st.offered = None
        if not st.screening:
            return f"Please submit your updated CV for the {st.topic} role and our recruitment team will contact you.", "general_inquiry"
        intro = f"Great, I'll ask you a few short questions for the {st.topic} role. "
        text, intent = self._next_screening_question(ack=False)
        return intro + text, intent

    def _next_screening_question(self, ack: bool) -> tuple:
        st = self.state
        if st.screening:
            st.asking = st.screening.pop(0)
            prefix = "Thank you. " if ack else ""
            return prefix + st.asking, "general_inquiry"
        st.asking = None
        cv = self.lookup("how can I submit my CV", None)
        tail = f" {cv[0]}" if cv and "cv" in cv[0].lower() else " The next step is to submit your updated CV."
        return (f"Thank you, I've noted your answers for the {st.topic} role.{tail} "
                "Our recruitment team will review your details and contact you."), "general_inquiry"

    def _stop_screening(self) -> None:
        self.state.asking = None
        self.state.screening = []

    def _more(self) -> Optional[tuple]:
        nxt = self.kb.next_after(self.state.last_ref)
        if not nxt:
            return None
        text, ref = nxt
        self.state.last_ref = ref
        return text, "general_inquiry"

    @staticmethod
    def _join(items: list) -> str:
        return ", ".join(items[:-1]) + " and " + items[-1] if len(items) > 1 else (items[0] if items else "")

    def _roles_sentence(self) -> str:
        roles = self.kb.roles()
        return f"We recruit for {self._join(roles)}." if roles else ""

    def _suggestions(self) -> str:
        roles = self.kb.roles()
        if roles:
            return (f"I can tell you about our {self._join(roles)} roles, their requirements and "
                    "responsibilities, the recruitment process, or how to apply.")
        return "You can ask me about our services, prices, opening hours or how to get in touch."

    def _fallback(self, repeat: bool = False) -> str:
        """Nothing in the knowledge base answers it: say so in a few words
        (different each time, in the visitor's language) and bring the
        conversation back to the roles the company is hiring for."""
        st = self.state
        st.fallbacks += 1
        st.turns += 1 if repeat else 0
        if repeat:
            return self._say("gibberish")
        if st.topic and _JOB_DETAIL.search(self._last_message):
            return self._say("fallback_topic", topic=st.topic)
        return self._say("fallback")
