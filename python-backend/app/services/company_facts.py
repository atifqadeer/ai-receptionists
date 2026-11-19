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
    "office_hours": (
        r"\b((office|opening|business|working) hours of (the|your) (company|office)|(your|the) (office|opening|business) hours|"
        r"when (is|are) (your|the) (office|company) open|when are you open|what time do you (open|close))\b"),
    "company_address": (
        r"\b((your|the|company|office|agency)('?s)? (address|location|postcode)|(your|the) (office|company) address|"
        r"address of (your|the) (company|office|agency)|where (is|are) (your|the) (office|company|agency|business)|"
        r"where are you (based|located)|company address|where can i (find|visit) you)\b"),
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


def detect(text: str) -> Optional[str]:
    """The company question asked in `text`, or None."""
    for name, pat in _COMPILED:
        if pat.search(text or ""):
            return name
    return None


def _clean(v: str) -> str:
    return re.sub(r"\s+", " ", (v or "").strip()).rstrip(".")


def _join(items: list) -> str:
    return ", ".join(items[:-1]) + " and " + items[-1] if len(items) > 1 else (items[0] if items else "")


def answer(intent: str, company: str, profile: dict, roles: Optional[list] = None,
           calling: bool = False) -> Optional[str]:
    """The answer to a company question. profile: Agent Setup's knowledge
    base (address, phone, email, business_hours, services). calling: we
    phoned them ("I'm calling from ..."), rather than them us."""
    profile = profile or {}
    company = _clean(company) or "our company"
    if intent == "company_name":
        return f"I'm calling from {company}." if calling else f"You're speaking with {company}."
    if intent == "roles":
        listed = _join(roles) if roles else _clean(profile.get("services") or "")
        return f"{company} recruits for {listed} positions." if listed else None
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
