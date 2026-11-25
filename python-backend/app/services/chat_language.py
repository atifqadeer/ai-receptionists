"""
Language and "what kind of message is this" for the rule-based agent (used
when no AI model is configured), so it answers the way a person would
instead of repeating one fixed sentence:

- the language the visitor writes in: English, Urdu (Urdu script) or
  Roman Urdu ("apke pas konse roles hain?"), detected per message;
- requests to change language ("chat in Urdu", "can you explain in roman
  urdu", "urdu mein baat karein", "switch to English");
- gibberish ("asdfgh", "???"), and questions that have nothing to do with
  the company (weather, cricket, jokes, ...);
- key Roman Urdu words glossed into English ("naukri" -> job, "tankhwah"
  -> salary), so the knowledge base can still be searched.

Replies come from a small phrase book in each language with several
variants per situation, and always steer back to the company's campaign:
the roles it is hiring for and how to apply (from the knowledge base).
Job details in the knowledge base are written in English: in Urdu or
Roman Urdu they are introduced as such, and the follow-up question is in
the visitor's language. With an AI model configured, the model answers in
the visitor's language itself (see AIAgent._build_system_prompt).
"""

import re
from typing import Optional

ENGLISH, URDU, ROMAN = "english", "urdu", "roman_urdu"
SUPPORTED = (ENGLISH, URDU, ROMAN)
NAMES = {ENGLISH: "English", URDU: "Urdu", ROMAN: "Roman Urdu"}

_URDU_SCRIPT = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
_OTHER_SCRIPT = re.compile(r"[ऀ-ॿЀ-ӿ一-鿿぀-ヿ가-힯฀-๿]")

# Roman Urdu words that are not also common English words ("main", "me",
# "to", "is", "hi" are left out: they would mark English as Urdu).
_ROMAN_WORDS = set("""
aap ap apka apke apki aapka aapke aapki apko aapko apne apni hum hamara hamare hamari humein mujhe mujh mera meri mere
tum tumhara kya kia kiya kyun kyu kyon kaise kese kaisay kahan kahaan kidhar kab kitna kitni kitne kaun kon konsa konse konsi
hai hain hein hy hoon hun hoga hogi hoge tha thi thay nahi nahin nai nhi haan ji jee theek thik acha accha achha
shukriya shukria meherbani mehrbani salam assalam assalamualaikum aoa walaikum alaikum khuda hafiz allah
karna karo karein karen krna kro kr kar karta karti karte batao bataen batayen bataye bataiye bataein samjhao samjha
bolo bolen likho chahiye chahta chahti chahte milega milegi milta milti mil sakta sakti sakte
naukri nokri kaam kam tankhwah tankha tankhah talab daftar pata rabta waqt timing jagah shehar
ke ki ka ko se pe mein mai liye wala wali wale bhi sirf abhi phir aur lekin magar
""".split())

# Roman Urdu -> English, so the knowledge base can be searched.
_GLOSS = {
    "naukri": "job", "nokri": "job", "kaam": "job work", "tankhwah": "salary", "tankha": "salary",
    "tankhah": "salary", "talab": "salary", "daftar": "office", "pata": "address", "rabta": "contact",
    "waqt": "hours time", "jagah": "location", "shehar": "city", "konse": "which", "konsa": "which",
    "konsi": "which", "kaun": "who", "kon": "who", "kahan": "where", "kahaan": "where", "kab": "when",
    "kaise": "how", "kese": "how", "kitni": "how much", "kitna": "how much", "kitne": "how many",
    "tajurba": "experience", "tajruba": "experience", "taleem": "qualification", "darkhwast": "apply application",
    "apply": "apply", "requirements": "requirements", "zaroorat": "requirements", "zimmedari": "responsibilities",
    "main": "i", "mai": "i", "hoon": "am", "hun": "am", "saal": "years", "sal": "years", "mahine": "months",
    "chahiye": "want", "chahta": "want", "chahti": "want", "chahte": "want", "batao": "tell", "bataen": "tell",
    "bataiye": "tell", "samjhao": "explain", "shartein": "requirements", "sharait": "requirements",
    "zimmedariyan": "responsibilities", "roles": "roles", "jobs": "jobs",
}

_LANG_NAMES = {
    "roman urdu": ROMAN, "urdu roman": ROMAN, "roman": ROMAN, "urdu": URDU, "اردو": URDU, "english": ENGLISH,
    "angrezi": ENGLISH, "inglish": ENGLISH,
}
_OTHER_LANGS = ("arabic", "hindi", "punjabi", "pashto", "sindhi", "balochi", "french", "spanish", "german",
                "chinese", "turkish", "persian", "farsi", "bengali", "italian", "portuguese", "russian")

_LANG_ALT = "roman urdu|urdu roman|urdu|اردو|english|angrezi|" + "|".join(_OTHER_LANGS)
_REQUEST = [
    rf"\b(chat|talk|speak|reply|respond|answer|write|explain|continue|text|message|baat|bolo|bolen|likho|samjhao|batao|bataen|bataiye)\b[^.?!]{{0,25}}\b(in|into|mein|me|main|mai)\s+({_LANG_ALT})\b",
    rf"\b(in|into|mein|me|main|mai)\s+({_LANG_ALT})\s+(please|plz|pls|baat|bolo|bolen|likho|samjhao|batao|bataen|karo|karein|karen|kro|kar)\b",
    rf"\b(switch|change|move)\b[^.?!]{{0,20}}\b(to|into)\s+({_LANG_ALT})\b",
    rf"\b(do|can|could) you (speak|understand|talk|write|know|chat)\s+(in\s+)?({_LANG_ALT})\b",
    rf"^\W*({_LANG_ALT})\W*(please|plz|pls)?\W*$",
    rf"\b({_LANG_ALT})\s+(mein|me|main)\s+(baat|bolo|likho|jawab)",
    r"اردو\s*(میں|مے)",
]

OFF_TOPIC = re.compile(
    r"\b(weather|forecast|mausam|joke|funny|lateefa|football|soccer|cricket|match|psl|ipl|rugby|tennis|"
    r"politic\w*|election|siyasat|president|prime minister|imran|nawaz|religio\w*|"
    r"bitcoin|crypto\w*|stock market|lottery|casino|gambling|betting|"
    r"movie|film|drama|netflix|song|gaana|gana|music|singer|celebrity|actor|actress|"
    r"recipe|cooking recipe|khana kaise|homework|math\w*|capital of|"
    r"girlfriend|boyfriend|shadi|marry me|date me|love you|pyar|"
    r"medical advice|diagnos\w*|legal advice|"
    r"write (me )?(a|an) (poem|essay|story|code)|poem|essay|game|games|play a game)\b", re.I)

# Words that keep a message about the company even if it trips OFF_TOPIC.
_ON_TOPIC = re.compile(r"\b(job|jobs|role|roles|position|vacanc\w*|salary|pay|apply|application|cv|interview|"
                       r"shift|hours|naukri|kaam|tankhwah|chef|nurse|manager|solicitor|recruit\w*|company|office)\b", re.I)


_ROLES_Q = re.compile(
    r"\b(konse|konsi|konsa|kaunsi|kaunse|kaun|kon|kya|kitne|kitni|koi|available)\b.*"
    r"\b(roles?|jobs?|naukri\w*|nokri\w*|vacanc\w*|positions?|kaam|opportunit\w*|aasami\w*)\b"
    r"|\b(roles?|jobs?|naukri\w*|nokri\w*|vacanc\w*|positions?)\b.*"
    r"\b(konse|konsi|kaunsi|kaun|kon|available|hain|hein|hai|milegi|milega|mil sakti|chahiye)\b", re.I)
_ROLES_Q_URDU = re.compile("(نوکری|نوکریاں|ملازمت|ملازمتیں|جاب|جابز|رول|آسامی|آسامیاں)")


def asks_roles(text: str) -> bool:
    """Asking which jobs there are, in Roman Urdu or Urdu."""
    return bool(_ROLES_Q.search(text or "") or _ROLES_Q_URDU.search(text or ""))


def words(text: str) -> list:
    return re.findall(r"[a-z']+", (text or "").lower())


def detect(text: str) -> Optional[str]:
    """The language of one message: english / urdu / roman_urdu, "other"
    for another script, None when it can't be told (too short)."""
    t = text or ""
    if len(_URDU_SCRIPT.findall(t)) >= 2:
        return URDU
    if len(_OTHER_SCRIPT.findall(t)) >= 2:
        return "other"
    w = words(t)
    if not w:
        return None
    hits = sum(1 for x in w if x in _ROMAN_WORDS)
    if (hits >= 2 and hits / len(w) >= 0.25) or (hits >= 1 and len(w) <= 3 and hits / len(w) >= 0.5):
        return ROMAN
    return ENGLISH if len(w) >= 2 else None


def requested(text: str) -> Optional[str]:
    """The language asked for ("chat in urdu" -> urdu), or None. Other
    languages come back by name ("arabic")."""
    t = (text or "").lower().strip()
    for pat in _REQUEST:
        m = re.search(pat, t)
        if m:
            name = next((g for g in reversed(m.groups()) if g and (g in _LANG_NAMES or g in _OTHER_LANGS)), None)
            if name is None and "اردو" in t:
                return URDU
            if name:
                return _LANG_NAMES.get(name, name)
    return None


def is_gibberish(text: str) -> bool:
    t = (text or "").strip()
    if not t or _URDU_SCRIPT.search(t):
        return False
    letters = re.sub(r"[^A-Za-z]", "", t)
    if not letters:                                   # only symbols, digits or emojis
        return not re.fullmatch(r"\W*\d+\W*", t) or len(t) > 12
    w = words(t)
    long_words = [x for x in w if len(x) >= 5]
    if long_words and all(not re.search(r"[aeiouy]", x) for x in long_words):
        return True                                   # "sdfghk", "qwrtyp"
    if re.search(r"(.)\1{4,}", t.lower()):            # "aaaaaa"
        return True
    if re.fullmatch(r"(asdf\w*|qwer\w*|zxcv\w*|hjkl\w*|jkl\w*)", t.lower()):
        return True
    # One made-up "word" typed on the keyboard: "asfdsdf", "dfgdfg", "sdfsdf".
    if len(w) == 1 and len(w[0]) >= 6 and re.fullmatch(r"[a-z]+", w[0]):
        if re.search(r"(sdf|dfg|fgh|ghj|hjk|jkl|qwe|xcv|zxc|asd|fds|gfd|lkj)", w[0]):
            return True
    return False


def is_off_topic(text: str) -> bool:
    return bool(OFF_TOPIC.search(text or "")) and not _ON_TOPIC.search(text or "")


def gloss(text: str) -> str:
    """Roman Urdu turned into English keywords for searching the knowledge
    base: job words translated ("tankhwah" -> salary), Urdu filler words
    ("ki", "hai", "mujhe") dropped. English text comes back unchanged."""
    w = words(text)
    if not any(x in _ROMAN_WORDS or x in _GLOSS for x in w):
        return text
    out = []
    for x in w:
        if x in _GLOSS:
            out.append(_GLOSS[x])
        elif x not in _ROMAN_WORDS:
            out.append(x)
    q = "?" if "?" in (text or "") else ""
    return (" ".join(out) + q).strip() or text


def _join(items: list, lang: str) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    last = {URDU: " اور ", ROMAN: " aur "}.get(lang, " and ")
    return ", ".join(items[:-1]) + last + items[-1]


# ---- phrase book ----
# {company} {agent} {roles} {contact} are filled in; several variants each,
# used in turn, so the agent doesn't repeat itself.

PHRASES = {
    ENGLISH: {
        "switched": ["Of course, let's continue in English. {pitch}"],
        "unsupported": ["Sorry, I can't chat in {asked}. I can only chat in {allowed}. {pitch}",
                        "I'm afraid {asked} isn't available here; I can help you in {allowed}. {pitch}"],
        "not_allowed": ["Sorry, I can only chat in {allowed}. Could you write your message in {allowed_or}? {pitch}",
                        "I'm afraid I can only reply in {allowed}. Please write in {allowed_or}. {pitch}"],
        "unsupported_call": ["I'm sorry, I can only speak {allowed} on this call. {pitch}"],
        "off_topic": ["That's a bit outside what I can help with here, but I'd love to help you find your next job. {pitch}",
                      "I'll leave that one to the experts! What I can help with is a new role with {company}. {pitch}",
                      "Good question, but it's not something I can help with on this chat. {pitch}"],
        "gibberish": ["Sorry, I didn't quite get that. Could you type it again? {pitch}",
                      "Hmm, that came through a bit jumbled. What would you like to know? {pitch}"],
        "fallback": ["I'm sorry, I don't have that information, and I'd rather not guess. Our recruitment team can "
                     "help{contact}. {pitch}",
                     "I'm not sure about that one, I'm afraid. Our recruitment team can help{contact}. {pitch}",
                     "That's not something I have details on. You're welcome to contact our recruitment team{contact}. "
                     "{pitch}"],
        "pitch": ["We're currently hiring for {roles} roles. Which one interests you?",
                  "Right now {company} is recruiting {roles}. Would you like the requirements for one of them?",
                  "I can tell you about our {roles} vacancies, what they pay, the requirements and how to apply. Which role should we start with?"],
        "pitch_none": ["I can help with our services, opening hours or how to get in touch. What would you like to know?"],
        "greet": ["Hello! I'm {agent} from {company}. {pitch}", "Hi there! {pitch}"],
        "greet_salam": ["Wa alaikum assalam! {pitch}"],
        "thanks": ["You're welcome! Is there anything else I can help you with?",
                   "My pleasure. Anything else you'd like to know about our roles?"],
        "only_pitch": ["{pitch}"],
        "fallback_topic": ["I don't have that detail for the {topic} role; our recruiter will confirm it with you{contact}. "
                           "Would you like the requirements or the main responsibilities instead?",
                           "That's something our recruiter will confirm for the {topic} role. Shall I take a few details for your application?"],
        "details_offer": ["Thank you for sharing that. Would you like me to take a few details for the {topic} role?"],
        "stopped": ["No problem, I've stopped the questions. What else would you like to know?"],
        "anything_else": ["No problem. Is there anything else I can help you with?"],
        "what_else": ["Great. What would you like to know? {pitch}"],
        "screening_start": ["Great, I'll ask you a few short questions for the {topic} role. {question}"],
        "screening_next": ["Thank you. {question}"],
        "lead": "",
        "follow": ["Which role are you interested in?", "Would you like to know anything else about this role?"],
    },
    ROMAN: {
        "switched": ["Zaroor! Ab hum Roman Urdu mein baat karte hain. {pitch}",
                     "Bilkul, main Roman Urdu mein jawab dunga. {pitch}"],
        "unsupported": ["Maazrat, main {asked} mein baat nahi kar sakta. Main sirf {allowed} mein madad kar sakta hoon. {pitch}"],
        "not_allowed": ["Maazrat, main sirf {allowed} mein jawab de sakta hoon. Kya aap {allowed_or} mein likh denge? {pitch}"],
        "unsupported_call": ["Maazrat, is call par main sirf {allowed} mein baat kar sakta hoon. {pitch}"],
        "off_topic": ["Ye sawal hamare kaam se thoda hat kar hai, lekin naukri dhoondne mein main zaroor madad kar sakta hoon. {pitch}",
                      "Is bare mein main madad nahi kar paunga, magar {company} mein job ke liye main haazir hoon. {pitch}"],
        "gibberish": ["Maazrat, mujhe samajh nahi aaya. Dobara likh denge? {pitch}",
                      "Lagta hai message theek se nahi aaya. Aap kya poochna chahte hain? {pitch}"],
        "fallback": ["Is bare mein mere paas maloomat nahi hai, hamari team aapki madad karegi{contact}. {pitch}",
                     "Ye sawal hamari recruitment team behtar bata sakti hai{contact}. {pitch}",
                     "Iska jawab mere paas nahi hai. {pitch}"],
        "pitch": ["Abhi hamare paas {roles} ki jobs hain. Aap kis role mein dilchaspi rakhte hain?",
                  "{company} is waqt {roles} ke liye bharti kar rahi hai. Kisi role ki requirements bataun?",
                  "Main aapko {roles} ki jobs, unki requirements aur apply karne ka tareeqa bata sakta hoon. Kis role se shuru karein?"],
        "pitch_none": ["Main hamari services, office timing ya rabta karne ke bare mein bata sakta hoon. Aap kya jaanna chahte hain?"],
        "greet": ["Assalam o alaikum! Main {company} se {agent} hoon. {pitch}"],
        "greet_salam": ["Wa alaikum assalam! {pitch}"],
        "thanks": ["Aapka shukriya! Kya main aur kisi cheez mein madad kar sakta hoon?"],
        "only_pitch": ["{pitch}"],
        "fallback_topic": ["{topic} role ki ye maloomat abhi mere paas nahi hai, hamara recruiter aapko confirm kar dega{contact}. "
                           "Kya main is role ki requirements ya zimmedariyan bataun?",
                           "Ye baat hamara recruiter {topic} role ke liye aapko confirm karega. Kya main aapki application ke liye kuch details le loon?"],
        "details_offer": ["Batane ka shukriya. Kya main {topic} role ke liye aapki kuch details le loon?"],
        "stopped": ["Theek hai, maine sawal rok diye hain. Aap aur kya jaanna chahenge?"],
        "anything_else": ["Koi baat nahi. Kya main kisi aur cheez mein madad kar sakta hoon?"],
        "what_else": ["Zaroor. Aap kya jaanna chahenge? {pitch}"],
        "screening_start": ["Zaroor! Main {topic} role ke liye kuch mukhtasar sawal poochunga (sawal English mein hain, "
                            "aap Urdu ya English mein jawab de sakte hain). {question}"],
        "screening_next": ["Shukriya. Agla sawal: {question}"],
        "lead": "Ye rahi maloomat (details English mein hain): ",
        "follow": ["Kya aap is role ke liye apply karna chahenge?", "Is bare mein aur kuch poochna chahenge?"],
    },
    URDU: {
        "switched": ["جی ضرور! اب ہم اردو میں بات کرتے ہیں۔ {pitch}"],
        "unsupported": ["معذرت، میں {asked} میں بات نہیں کر سکتا۔ میں صرف {allowed} میں مدد کر سکتا ہوں۔ {pitch}"],
        "not_allowed": ["معذرت، میں صرف {allowed} میں جواب دے سکتا ہوں۔ کیا آپ {allowed_or} میں لکھ دیں گے؟ {pitch}"],
        "unsupported_call": ["معذرت، اس کال پر میں صرف {allowed} میں بات کر سکتا ہوں۔ {pitch}"],
        "off_topic": ["یہ سوال ہمارے کام سے ذرا ہٹ کر ہے، لیکن نوکری ڈھونڈنے میں میں ضرور مدد کر سکتا ہوں۔ {pitch}",
                      "اس بارے میں میں مدد نہیں کر پاؤں گا، مگر {company} میں ملازمت کے لیے حاضر ہوں۔ {pitch}"],
        "gibberish": ["معذرت، مجھے سمجھ نہیں آیا۔ کیا آپ دوبارہ لکھ دیں گے؟ {pitch}"],
        "fallback": ["اس بارے میں میرے پاس معلومات نہیں ہیں، ہماری ٹیم آپ کی مدد کرے گی{contact}۔ {pitch}",
                     "اس کا جواب ہماری ریکروٹمنٹ ٹیم بہتر دے سکتی ہے{contact}۔ {pitch}"],
        "pitch": ["اس وقت ہمارے پاس {roles} کی نوکریاں ہیں۔ آپ کس رول میں دلچسپی رکھتے ہیں؟",
                  "{company} اس وقت {roles} کے لیے بھرتی کر رہی ہے۔ کیا میں کسی رول کی شرائط بتاؤں؟"],
        "pitch_none": ["میں ہماری سروسز، دفتری اوقات یا رابطے کے بارے میں بتا سکتا ہوں۔ آپ کیا جاننا چاہتے ہیں؟"],
        "greet": ["السلام علیکم! میں {company} سے {agent} ہوں۔ {pitch}"],
        "greet_salam": ["وعلیکم السلام! {pitch}"],
        "thanks": ["آپ کا شکریہ! کیا میں کسی اور چیز میں مدد کر سکتا ہوں؟"],
        "only_pitch": ["{pitch}"],
        "fallback_topic": ["{topic} رول کی یہ معلومات ابھی میرے پاس نہیں ہیں، ہمارا ریکروٹر آپ کو تصدیق کر دے گا{contact}۔ "
                           "کیا میں اس رول کی شرائط یا ذمہ داریاں بتاؤں؟"],
        "details_offer": ["بتانے کا شکریہ۔ کیا میں {topic} رول کے لیے آپ کی کچھ تفصیلات لے لوں؟"],
        "stopped": ["ٹھیک ہے، میں نے سوالات روک دیے ہیں۔ آپ اور کیا جاننا چاہیں گے؟"],
        "anything_else": ["کوئی بات نہیں۔ کیا میں کسی اور چیز میں مدد کر سکتا ہوں؟"],
        "what_else": ["ضرور۔ آپ کیا جاننا چاہیں گے؟ {pitch}"],
        "screening_start": ["ضرور! میں {topic} رول کے لیے چند مختصر سوال پوچھوں گا (سوال انگریزی میں ہیں، آپ اردو یا انگریزی میں جواب دے سکتے ہیں)۔ {question}"],
        "screening_next": ["شکریہ۔ اگلا سوال: {question}"],
        "lead": "یہ رہی معلومات (تفصیل انگریزی میں ہے): ",
        "follow": ["کیا آپ اس رول کے لیے اپلائی کرنا چاہیں گے؟", "کیا آپ اس بارے میں مزید کچھ پوچھنا چاہیں گے؟"],
    },
}


# Language names, written in each reply language.
_LANG_NAMES_IN = {
    ENGLISH: {"english": "English", "urdu": "Urdu", "roman_urdu": "Roman Urdu", "arabic": "Arabic", "hindi": "Hindi",
              "punjabi": "Punjabi", "spanish": "Spanish", "french": "French"},
    ROMAN: {"english": "English", "urdu": "Urdu", "roman_urdu": "Roman Urdu", "arabic": "Arabi", "hindi": "Hindi",
            "punjabi": "Punjabi", "spanish": "Spanish", "french": "French"},
    URDU: {"english": "انگریزی", "urdu": "اردو", "roman_urdu": "رومن اردو", "arabic": "عربی", "hindi": "ہندی",
           "punjabi": "پنجابی", "spanish": "ہسپانوی", "french": "فرانسیسی"},
}


def lang_name(lang: str, lang_id: str) -> str:
    return _LANG_NAMES_IN.get(lang, _LANG_NAMES_IN[ENGLISH]).get(lang_id, lang_id.replace("_", " ").title())


def _list(lang: str, ids: list, last_word: Optional[str] = None) -> str:
    items = [lang_name(lang, i) for i in ids]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if last_word is None:
        last_word = {URDU: " اور ", ROMAN: " aur "}.get(lang, " and ")
    return ("، " if lang == URDU else ", ").join(items[:-1]) + last_word + items[-1]


def phrase(lang: str, key: str, turn: int, **kw) -> str:
    """A variant of the phrase `key` in `lang` (rotating with `turn`), with
    the campaign pitch filled in."""
    book = PHRASES.get(lang) or PHRASES[ENGLISH]
    roles = kw.get("roles") or []
    company = kw.get("company") or "our company"
    contact = kw.get("contact") or ""
    if contact:
        contact = {ROMAN: f" ({contact} par)", URDU: f" ({contact} پر)"}.get(lang, f" on {contact}")
    pitches = book["pitch"] if roles else book["pitch_none"]
    pitch = pitches[turn % len(pitches)].format(roles=_join(roles, lang), company=company)
    variants = book[key]
    text = variants[turn % len(variants)] if isinstance(variants, list) else variants
    out = text.format(pitch=pitch, pitch_lc=pitch[:1].lower() + pitch[1:], company=company,
                      agent=kw.get("agent") or "the assistant", contact=contact, asked=kw.get("asked") or "that language",
                      topic=kw.get("topic") or "this", question=kw.get("question") or "",
                      allowed=_list(lang, kw.get("allowed") or [ENGLISH]),
                      allowed_or=_list(lang, kw.get("allowed") or [ENGLISH], {URDU: " یا ", ROMAN: " ya "}.get(lang, " or ")))
    return re.sub(r"\s+", " ", out).strip()


def localize(lang: str, english_text: str, turn: int) -> str:
    """An English knowledge-base answer for a visitor writing in Urdu or
    Roman Urdu: introduced in their language, with the follow-up question
    in their language."""
    if lang not in (URDU, ROMAN) or not english_text:
        return english_text
    book = PHRASES[lang]
    body = english_text.strip()
    if body.endswith("?"):
        return f"{book['lead']}{body}"
    follow = book["follow"][turn % len(book["follow"])]
    return f"{book['lead']}{body} {follow}"
