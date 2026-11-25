"""
What the other person on a call has decided, from what they said.

Used by every kind of call (job calls, dial-pad calls, inbound calls), so
the agent reacts the same way everywhere:

  do_not_call     "don't call me again", "take me off your list"
                  -> the agent says goodbye, the call is dropped, the
                     status is "dnc" and the number goes on the Do Not
                     Call list (it is never dialled again)
  not_interested  "I'm not interested", "I've already got a job"
                  -> goodbye, call dropped, status "not_interested"
  wrong_number    "you've got the wrong number", "I never applied"
                  -> apology, call dropped, status "wrong_number"
  voicemail       "please leave a message after the tone"
                  -> a short message, call dropped, retried later
  callback        "call me back tomorrow", "I'm driving"
                  -> call dropped, status "callback" (when they asked for
                     is kept in callback_when)
  end_call        "drop the call", "hang up", "I have to go"
                  -> the agent says goodbye and ends the call, status "dropped"
  abusive         swearing at the agent
                  -> the agent ends the call politely
  unsure          "maybe", "I'm not sure"           (call carries on)
  send_details    "can you email me the details"    (call carries on)

detect() looks at what was said on its own. A bare "no" depends on the
question it answers, so the conversations handle it themselves
(is_bare_no). The phrases cover common British and American wording and
what speech recognition makes of it (missing apostrophes: "dont", "im").
"""

import re
from typing import Optional

# Outcomes that end the call.
ENDING = ("do_not_call", "not_interested", "wrong_number", "voicemail", "callback", "abusive", "end_call")

# The call's final status for each outcome (shown in the call lists).
STATUS_FOR = {
    "do_not_call": "dnc",
    "not_interested": "not_interested",
    "wrong_number": "wrong_number",
    "callback": "callback",
    "abusive": "completed",
    "end_call": "dropped",
}

_CALL = r"(call|calling|ring|ringing|phone|phoning|contact|contacting|bother|bothering|text|texting|message|messaging)"

_DNC = [
    # don't call me again / do not ring this number / never contact me
    rf"\b(don'?t|do not|dont|never|please don'?t)( you)?( ever)? {_CALL}( me| us| this number| here| this phone)?( again| anymore| any more| back)?\b",
    rf"\b(stop|quit|cease) {_CALL}( me| us| this number)?\b",
    rf"\b(no|don'?t want( any)?) (more )?(calls|phone calls|contact)\b",
    r"\bi (don'?t|do not) want (you|anyone|to be) (to )?(call|ring|phone|contact|called|rung|contacted)",
    r"\b(remove|delete|erase|take) (me|my (number|details|data|name|information|info))( off| from| out of)?\b",
    r"\b(take|get) me off\b",
    r"\boff (your|the) (list|database|system|records|calling list|books)\b",
    r"\b(do not call|do-not-call|dnc) (list|register)\b",
    r"\b(unsubscribe|opt me out|opt out)\b",
    r"\b(i'?m|i am|this number is) (registered )?(on|with) the (tps|telephone preference)",
    r"\b(lose|forget) my number\b",
    r"\bleave me alone\b",
    r"\b(this is|stop the|i'?ll report (you|this)|that'?s) harass\w*",
    r"\bharass(ing|ment)\b",
    r"\b(i'?ll|i will|going to) report (you|this|your company)\b",
]

_NOT_INTERESTED = [
    r"\bnot (really |at all |even )?(interested|keen|bothered)\b",
    r"\b(i'?m|im|i am) not (really )?(looking|after|searching)\b",
    r"\bnot (looking|searching) for (a |any |another |new )?(job|work|role|position|anything)",
    r"\bno,? thanks?\b|\bno thank you\b|\bno ta\b",
    r"\b(it'?s|that'?s|this is|that is) not (for me|my thing|what i'?m looking for|right for me|for us)\b",
    r"\bnot for me\b",
    r"\b(i'?ll|i will) (pass|give it a miss|leave it)\b",
    r"\bpass on (it|this|that)\b",
    r"\b(already|just) (found|got|have|started|accepted|taken|signed) (a |another |my |the )?(new )?(job|position|role|work|contract|offer)",
    r"\b(i'?ve|i have|ive) (got|already got|found|got myself) (a |another |my )?(new )?(job|position|role|work)\b",
    r"\b(i'?m|im|i am) (happily |currently |already )?(employed|working (now|already|full ?time)|retired|settled|happy (where i am|in my (job|role|current)))",
    r"\b(i )?(don'?t|do not|dont) (need|want) (a |the |this |that |any |another )?(job|position|role|work|it|offer)\b",
    r"\b(no|nah|nope),? (i'?m|im|i am) (not|ok|okay|good|fine|alright|all right)\b",
    r"\b(i'?m|im|i am) (ok|okay|good|fine|alright|all right),? (thanks|thank you|cheers)\b",
    r"\b(no way|absolutely not|definitely not|certainly not|not a chance|not at all)\b",
    r"\bchanged my mind\b",
    r"\b(not|no longer) (available|looking) for (work|jobs|roles)\b",
    r"\b(don'?t|do not|dont) (bother|worry about it)\b",
]

_WRONG_NUMBER = [
    r"\bwrong (number|person|guy|man|lady|woman|house)\b",
    r"\b(there'?s|there is) no ?(one|body) (here )?(called|named|by that name)\b",
    r"\bno ?(one|body) (here )?(called|named|by (that|this) name)\b",
    r"\b(i )?(never|didn'?t|did not|have not|haven'?t) (ever )?appl(y|ied)\b",
    r"\b(i )?(don'?t|do not) know (who|what) (that|you'?re|you are|this is)\b",
    r"\bnot me\b",
]

_VOICEMAIL = [
    r"\b(leave|record) (a|your) (message|voicemail)\b",
    r"\bafter the (tone|beep)\b",
    r"\b(the person|the number|the customer|the subscriber) you (are|have) (calling|called|dialled|dialed)\b",
    r"\b(is )?not available (to take your call|right now|at the moment)\b",
    r"\b(voice ?mail|mailbox|answer ?phone|answering machine)\b",
    r"\bplease try (again )?later\b",
]

_CALLBACK = [
    r"\b(call|ring|phone|try) (me )?(back|again )?(later|tomorrow|tonight|this (afternoon|evening)|next week|another time|in (a|an|\d+|half an) (hour|minute|bit)|after \d)",
    r"\b(call|ring) me back\b",
    r"\b(not|isn'?t) a (good|great) time\b|\bbad time\b",
    r"\b(i'?m|im|i am) (driving|at work|in a meeting|busy|working|on the other line|in the middle of something|out)\b",
    r"\bcan'?t (talk|speak) (right )?now\b",
    # "when I'm free I'll call you back" / "I'll get back to you"
    r"\b(i'?ll|i will|let me) (call|ring|phone|get back to|contact) (you|ya)( back| later)?\b",
    r"\bwhen (i'?m|i am|i get) (free|home|back|off work|a (minute|moment|chance))\b",
    r"\b(call|ring) me (when|later|after)\b",
    # "call me on Monday afternoon", "ring me at 3pm", "phone me tomorrow"
    r"\b(call|ring|phone|try) me (back |again )?(on|at|around|after|tomorrow|today|tonight|next|this|in the) ?"
    r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d|morning|afternoon|evening|week|noon)",
]

# "Drop the call" / "hang up" ("don't hang up" is the opposite).
_END_CALL = [
    r"\b(drop|end|cut|finish|terminate|close|disconnect|stop|kill) (the |this |my |our )?(call|phone call|line|conversation|chat)\b",
    r"(?<!don't )(?<!dont )(?<!do not )(?<!never )\b(hang up|put the phone down|disconnect( now)?|cut me off)\b",
    r"\b(i('ve| have)?|i'?ve) (got|have|need|gotta) to go\b|\bgotta go\b|\b(i must|i need to) go\b",
]

# What follows "don't call me ..." that makes it a callback, not a refusal:
# "don't call me at work, call me tonight".
_CALLBACK_INSTEAD = re.compile(
    r"\b(call|ring|phone) (me )?(back )?(later|tomorrow|tonight|in the (evening|morning|afternoon)|after|at|on|next|this)\b")
_REFUSAL_WORDS = re.compile(r"\b(again|anymore|any more|never|stop|remove|list|ever|leave me)\b")

_ABUSIVE = re.compile(r"\b(f+u+c+k\w*|piss off|bugger off|sod off|shut up|wanker|bastard|bitch|arsehole|asshole|"
                      r"go to hell|scam+er|you'?re a scam)\b"
                      r"|\b[a-z]\*{2,}")       # profanity masked by speech-to-text ("f***")

_UNSURE = re.compile(r"^\W*(maybe|perhaps|possibly|not sure|i'?m not sure|i don'?t know|dunno|i'?ll think about it|"
                     r"let me think( about it)?|i need to think( about it)?|might be|could be)\W*(yeah|really|yet)?\W*$")

_SEND_DETAILS = re.compile(r"\b(send|email|e-mail|text|whatsapp|message) (me )?(the |more |some |all the |full )?"
                           r"(details|info|information|description|job spec|spec|it|that)\b|"
                           r"\b(can|could) you (email|text|send)\b")

_BARE_NO = re.compile(r"^\W*(no|nope|nah|no sorry|sorry no|not really|no not really|no i'?m not|not now|"
                      r"no it'?s fine|no it'?s ok(ay)?|i'?m not|i don'?t think so|don'?t think so)\W*$")


def normalize(text: str) -> str:
    """Lower case, straight apostrophes, and the apostrophes speech
    recognition leaves out ("dont" -> "don't", "im" -> "i'm")."""
    t = (text or "").lower().replace("’", "'").replace("‘", "'")
    t = re.sub(r"\b(don|doesn|didn|can|won|isn|aren|wasn|haven|hasn|wouldn|shouldn|couldn)t\b", r"\1't", t)
    t = re.sub(r"\bim\b", "i'm", t)
    t = re.sub(r"\bive\b", "i've", t)
    t = re.sub(r"\bill\b(?= (pass|call|think|leave|report))", "i'll", t)
    return re.sub(r"\s+", " ", t).strip()


def _any(patterns: list, text: str) -> bool:
    return any(re.search(p, text) for p in patterns)


# A live person asking to leave a message ("can I leave a message for the
# recruiter?") is not an answering machine: the agent used to read its
# voicemail line and hang up on them. A machine says "after the tone".
_SELF_REQUEST = re.compile(r"\b(can|could|may|shall|should) i\b|\bi('?d| would)? ?(like|want|wanna|need) to\b|"
                           r"\b(leave|take) me a\b|\?\s*$")
_MACHINE_ONLY = re.compile(r"\bafter the (tone|beep)\b|\bnot available to take your call\b|"
                           r"\b(the person|the number|the customer|the subscriber) you (are|have) (calling|called|dialled|dialed)\b|"
                           r"\byou (have|'?ve) reached\b|\bmailbox (is )?full\b")


def _asks_to_leave_message(t: str) -> bool:
    return bool(_SELF_REQUEST.search(t)) and not _MACHINE_ONLY.search(t)


def detect(text: str, allow_voicemail: bool = True) -> Optional[str]:
    """The decision in `text`, or None. Order matters: a refusal wins over
    everything else ("not interested, don't call me again" is a DNC)."""
    t = normalize(text)
    if not t:
        return None
    if allow_voicemail and _any(_VOICEMAIL, t) and len(t.split()) >= 4 and not _asks_to_leave_message(t):
        return "voicemail"
    if _any(_DNC, t):
        # "Why don't you call me tomorrow" / "don't call me at work, call
        # me tonight" ask for a better time.
        if (re.search(r"\bwhy (don'?t|not) you\b", t) or _CALLBACK_INSTEAD.search(t)) and not _REFUSAL_WORDS.search(t):
            return "callback"
        return "do_not_call"
    if _ABUSIVE.search(t):
        return "abusive"
    if _any(_WRONG_NUMBER, t):
        return "wrong_number"
    if _any(_CALLBACK, t) and not re.search(r"\bnot interested\b", t):
        return "callback"
    if _any(_NOT_INTERESTED, t):
        # "I'm not sure I'm not interested" / "not uninterested" are rare;
        # "I'm interested, no thanks needed" isn't, so a clear yes wins.
        if re.search(r"\b(i'?m|i am|yes|yeah) (very |really |definitely )?interested\b", t) and \
                not re.search(r"\bnot (really |at all )?interested\b", t):
            return None
        return "not_interested"
    if _any(_END_CALL, t):
        return "end_call"
    if _UNSURE.search(t):
        return "unsure"
    if _SEND_DETAILS.search(t):
        return "send_details"
    return None


def is_bare_no(text: str) -> bool:
    """A plain "no" (to "would you be interested?")."""
    return bool(_BARE_NO.search(normalize(text)))


_WHEN = re.compile(
    r"\b(later( today| on)?|today|tomorrow( morning| afternoon| evening)?|tonight|(this|in the) (morning|afternoon|evening)|"
    r"next (week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)( morning| afternoon| evening)?|"
    r"(on |this )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)( morning| afternoon| evening)?|"
    r"in (a|an|\d+|half an) (hour|hours|minute|minutes|bit)|"
    r"(at|after|around|about|by) \d{1,2}([:.]\d\d)?( ?(am|pm|o'?clock))?|\d{1,2}([:.]\d\d)? ?(am|pm)|"
    r"(at |around )?(noon|midday|lunch ?time)|another time)\b")


def callback_when(text: str) -> str:
    """The time the person asked for (a callback or a meeting), as they said
    it: "tomorrow morning", "Thursday at 2pm", "in 2 hours"; "" when they
    named none."""
    t = normalize(text)
    # "I have a meeting at 3, call me back after 5pm": the time after "call me".
    asked = list(re.finditer(r"\b(call|ring|phone|try|contact) (me|us)\b", t))
    if asked and _WHEN.search(t, asked[-1].end()):
        t = t[asked[-1].end():]
    parts = [m.group(0) for m in _WHEN.finditer(t)]
    when = " ".join(dict.fromkeys(parts))
    return re.sub(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", lambda m: m.group(1).title(), when)


# "Can you schedule a meeting with the recruiter?", "I'd like to book an
# appointment", "can we arrange an interview".
_MEETING = re.compile(
    r"\b((schedule|book|arrange|set ?up|organi[sz]e|fix|make|get|request|want|need|like)( me)?( in for)? (a |an |the |my )?"
    r"(meeting|appointment|interview|call with|chat with|video call|zoom|teams call|face to face)|"
    r"(meet|speak|talk) (with |to )?(the |a |your )?(recruiter|recruitment team|consultant|someone|manager|human|person)|"
    r"(meeting|appointment|interview) with (the |a |your )?(recruiter|recruitment team|consultant|team|someone|you)|"
    r"(when|can|could) (can |could )?(i|we) (meet|come in|visit)|"
    r"book me in|(book|schedule|arrange) (it|one|that|a time|a slot))\b")


def is_meeting_request(text: str) -> bool:
    """They ask for a meeting, appointment or interview with the team."""
    return bool(_MEETING.search(normalize(text)))
