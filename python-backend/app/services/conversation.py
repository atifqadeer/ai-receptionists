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
- the agent never sends the same reply twice in a row.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from app.services.knowledge import KnowledgeBase, key_words

_QUESTION_START = {
    "what", "how", "can", "could", "do", "does", "did", "is", "are", "which",
    "who", "where", "when", "why", "will", "would", "should", "tell", "explain",
    "any", "may", "have", "has",
}
_YES = {"yes", "yeah", "yep", "yup", "sure", "ok", "okay", "please", "alright", "definitely", "absolutely", "go", "ahead", "start", "proceed"}
_NO = {"no", "nope", "nah", "not", "later", "stop", "cancel"}
_MORE = re.compile(r"\b(tell me more|more (info|information|details)|go on|what else|anything else|continue|carry on)\b", re.I)
_NEXT_STEP = re.compile(r"\b(next step|what (should|do|can) i do( now| next)?|how (do|can|should) i (start|proceed|go ahead)|what now|help me)\b", re.I)
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


def _words(text: str) -> list:
    return re.findall(r"[a-z']+", (text or "").lower())


def is_question(text: str) -> bool:
    w = _words(text)
    return "?" in text or (bool(w) and w[0] in _QUESTION_START)


def is_yes(text: str) -> bool:
    w = _words(text)
    return bool(w) and len(w) <= 5 and bool(set(w) & _YES) and not set(w) & {"no", "not"}


def is_no(text: str) -> bool:
    w = _words(text)
    return bool(w) and len(w) <= 4 and bool(set(w) & _NO)


class Conversation:
    """One caller turn, answered from the knowledge base with the call's
    state. `lookup(message, topic)` is the agent's knowledge lookup and
    returns (answer, intent, ref) or None."""

    def __init__(self, kb: KnowledgeBase, state: CallState, lookup, contact: str = ""):
        self.kb = kb
        self.state = state
        self.lookup = lookup
        self.contact = contact

    def reply(self, message: str) -> tuple:
        text, intent = self._reply(message)
        # Never the same reply twice in a row.
        if text == self.state.last_reply:
            text, intent = self._fallback(repeat=True), "other"
        self.state.last_reply = text
        return text, intent

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
            aspect = key_words(message) - key_words(role) - {"job", "about", "interested", "looking", "apply", "role", "experienced", "qualified"}
            if not aspect or not is_question(message) and len(aspect) <= 1:
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
                return (f"We currently recruit for {self._join(roles)} positions. "
                        "Which role are you interested in?"), "general_inquiry"

        # 6) The knowledge base.
        found = self.lookup(message, st.topic)
        if found:
            answer, intent, ref = found
            if ref:
                st.last_ref = ref
            st.offered = None
            st.fallbacks = 0
            return answer, intent

        # 7) A statement about the caller while a role is being discussed
        # ("I have 5 years experience"): offer to take their details.
        if st.topic and not is_question(message) and self.kb.screening_questions(st.topic):
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
        st = self.state
        st.fallbacks += 1
        contact = f" Our team can also help you at {self.contact}." if self.contact else ""
        if repeat:
            return "I've shared what I have on that. Could you ask it another way? " + self._suggestions()
        if st.fallbacks % 2 == 1:
            return "I'm sorry, I don't have that information in my knowledge base. " + self._suggestions() + contact
        return "I'm not sure about that one. " + self._suggestions() + " What would you like to know?"
