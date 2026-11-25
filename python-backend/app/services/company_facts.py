"""
Questions about the company itself, answered from Agent Setup.

"What is your company name?", "what's your address?", "how can I contact
you?", "what roles do you recruit for?" are answered straight from the
company details in Agent Setup (Identity: company name; Knowledge Base:
address, phone, email, business hours, services) and the role documents.
A keyword search of the knowledge documents gets these wrong: the nearest
passage wins ("The candidate provides: full name, contact details ...").

Used by the AI agent (chat, inbound calls, dial-pad calls) and by the job
calls (outbound.CallConversation).
"""

import re
from typing import Optional

# intent -> pattern. Checked in this order: the first match wins, so the
# specific questions (address, contact) come before the company's name.
PATTERNS = {
    # "Where did you get my number?" (before the contact details: "number")
    "how_number": (
        r"\b((how|where|from where) (did |do |have |had )?(you|u|your company) (get|got|find|found|obtain\w*|take|took) "
        r"(my|this|me|the) ?(number|details|contact|phone number|info)?|who gave you my (number|details)|"
        r"why do you have my (number|details)|where('?s| is| did) my (number|details) (come )?from)"),
    # "Why did you call me?" / "What is this call about?"
    "why_call": (
        r"\b(why (did|are|were|have|do) (you|u) (call\w*|ring\w*|phon\w*|contact\w*)( me)?|"
        r"what (is|was|'?s) (this|the|your) call (about|regarding|for)|what are you calling (about|for)|"
        r"why (is|are) (you|someone|somebody) calling|what do you want( from me)?|why me)\b"),
    "office_hours": (
        r"\b((office|opening|business|working) hours of (the|your) (company|office)|(your|the) (office|opening|business) hours|"
        r"when (is|are) (your|the) (office|company) open|when are you open|what time do you (open|close))\b"),
    "company_address": (
        r"\b((your|the|company|office|agency)('?s)? (address|location|postcode|post code|zip code|whereabouts)|"
        r"(your|the) (office|company) address|(office|physical|postal|mailing|full|exact|business) address|"
        r"address of (your|the) (company|office|agency|business)|"
        r"where (is|are) (your|the) (office|offices|company|agency|business|premises|headquarters|hq|head office|branch)|"
        r"where('?s| is) (your|the) (office|company|agency|head office|headquarters|branch)|"
        r"where are you(?! calling)( guys| people)?( based| located| situated| from)?\W*$|"
        r"where are you (based|located|situated)|where do you (operate|work) from|"
        r"(head|main) office|(office|company) (is )?(located|based|situated)|located where|"
        r"company address|where can i (find|visit|meet) you|"
        r"(how|where) (do|can|could|would|should) i (get|go|come|find|reach|visit)( to)? (you|your (office|company|agency)|the office)|"
        r"directions to (you|your|the) ?(office|company)?|(visit|come to|drop by|walk in to) (you|your|the) (office|company|agency)|"
        r"(send|post|mail) (my )?(cv|documents|letter|post) to\b.*\baddress|what is your address|your address)\b"),
    # "What services do you offer?" / "What does your company do?"
    "company_services": (
        r"\b(what (services|kind of services|type of services|service) (do|does|can|will) (you|u|your (company|agency|team)|the (company|agency))( guys)? (offer|provide|do|have|give)|"
        r"(your|the company'?s|the agency'?s) services|services (do you|you) (offer|provide)|"
        r"what (kind|type|sort) of (company|business|agency|firm) (is (this|it)|are you)|"
        r"what (does|do) (your|the) (company|agency|business|firm) do|what do you (guys )?do\W*$|"
        r"what is (your|the) (company|business|agency) about)\b"),
    "company_contact": (
        r"\b((your|the|company'?s?|office|agency) (phone|telephone|contact|email|e-mail)( number| address| details)?|"
        r"how (can|do|could) i (contact|reach|call|email|get (hold|in touch)( of| with)?) (you|the company|your (team|office))|"
        r"contact (details|number|information))\b"),
    "roles": (
        r"\b((what|which) (other |kind of |type of |types of )?(roles|jobs|positions|vacancies|posts|opportunities)|"
        r"(roles|jobs|positions|vacancies) (are|do|does|did) (you|your company|the company)|"
        r"(roles|jobs|positions|vacancies|services) (that )?(you|your company|the company) (are |is )?(provid|offer|hir|recruit|ha(ve|s))\w*|"
        r"what (is|are) the (roles|jobs|positions|vacancies)|(any|other|more) (roles|jobs|positions|vacancies|opportunities)|"
        r"what (do|does) (you|your company|the company|your agency) (do|recruit|provide|offer|hire)|"
        r"(recruit|hire|hiring|recruiting) for)\b"),
    "company_name": (
        r"\b(name of (your|the|this) (company|agency|organi[sz]ation|firm|business)|(your|the) (company|agency)'?s? name|"
        r"what('?s| is) (your|the) (company|agency)( called| name|\W*$)|which (company|agency) (is (this|it)|are you( from)?)|"
        r"what (company|agency) (is (this|it)|are you( from)?)|who do you work for|company name|who (is|are) (this|you)\b.*\bcompany)\b"),
}

_COMPILED = [(name, re.compile(p, re.I)) for name, p in PATTERNS.items()]


_WHERE = re.compile(r"\b(where|location|located|address|based|situated|postcode|directions|office)\b", re.I)
_NAME_SKIP = {"the", "ltd", "limited", "llc", "inc", "plc", "and", "co", "company", "group"}


def names_company(text: str, company: str) -> bool:
    """`text` names the company ("Kingsbury Personnel", or just "Kingsbury")."""
    words = [w for w in re.findall(r"[a-z0-9]+", (company or "").lower()) if w not in _NAME_SKIP and len(w) > 2]
    low = (text or "").lower()
    return bool(words) and (" ".join(words) in low or words[0] in re.findall(r"[a-z0-9]+", low))


def detect(text: str, company: str = "") -> Optional[str]:
    """The company question asked in `text`, or None. company: its name,
    so "where is Kingsbury Personnel?" asks for the office address."""
    for name, pat in _COMPILED:
        if pat.search(text or ""):
            return name
    if company and _WHERE.search(text or "") and names_company(text, company):
        return "company_address"
    return None


def _clean(v: str) -> str:
    return re.sub(r"\s+", " ", (v or "").strip()).rstrip(".")


def _join(items: list) -> str:
    return ", ".join(items[:-1]) + " and " + items[-1] if len(items) > 1 else (items[0] if items else "")


def answer(intent: str, company: str, profile: dict, roles: Optional[list] = None,
           calling: bool = False, overview: str = "") -> Optional[str]:
    """The answer to a company question. profile: Agent Setup's knowledge
    base (address, phone, email, business_hours, services). calling: we
    phoned them ("I'm calling from ..."), rather than them us."""
    profile = profile or {}
    company = _clean(company) or "our company"
    if intent == "how_number":
        return (f"Your details are registered with {company}, which is why we're "
                f"{'calling you' if calling else 'in touch'} about job opportunities. If you'd rather not be "
                f"contacted, just tell me and I'll make sure we don't call you again.")
    if intent == "why_call":
        return (f"{'I am' if calling else 'We were'} calling from {company} about job opportunities that may match "
                f"your experience. Are you currently looking for a new role?")
    if intent == "company_name":
        return f"I'm calling from {company}." if calling else f"You're speaking with {company}."
    if intent == "roles":
        listed = _join(roles) if roles else _clean(profile.get("services") or "")
        return f"{company} recruits for {listed} positions." if listed else None
    if intent == "company_services":
        # The company introduction from the knowledge documents, and the roles.
        listed = _join(roles) if roles else _clean(profile.get("services") or "")
        parts = [overview.strip()] if overview.strip() else []
        if listed:
            parts.append(f"We recruit for {listed} positions." if overview.strip() else
                         f"{company} recruits for {listed} positions.")
        return " ".join(parts) or None
    if intent == "company_address":
        a = _clean(profile.get("address") or "")
        return f"Our office address is {a}." if a else None
    if intent == "company_contact":
        phone, email = _clean(profile.get("phone") or ""), (profile.get("email") or "").strip()
        parts = [f"call us on {phone}" if phone else "", f"email us at {email}" if email else ""]
        parts = [x for x in parts if x]
        return ("You can " + " or ".join(parts) + ".") if parts else None
    if intent == "office_hours":
        h = _clean(profile.get("business_hours") or "")
        return f"Our office hours are {h}." if h else None
    return None
