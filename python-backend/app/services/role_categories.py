"""
Job categories, so a job call stays on its own kind of work.

On a call about a Registered Manager role the agent talks about that role
and, when asked "what other roles do you have?", only roles in the same
category (care and health: Nurse, Registered Manager...), never Chef or
Solicitor roles. Categories come from words in the role title (and, when
the title says nothing, its description).
"""

import re
from typing import Optional

# category -> words in a title that place a role in it (checked in order:
# "registered manager" is care before the generic "manager" could match)
CATEGORIES = [
    ("care and health", r"nurs\w*|care|carer|caring|health ?care|hca|support worker|registered manager|"
                        r"deputy manager|home manager|clinical|clinic|midwi\w*|physio\w*|doctor|gp|pharmac\w*|"
                        r"therap\w*|dental|dentist|hospital|ward|patient|residential|domiciliary|social work\w*|"
                        r"occupational|paramedic|radiograph\w*|psychiatr\w*|mental health|cqc|nmc"),
    ("hospitality and catering", r"chef|cook|kitchen|catering|caterer|porter|waiter|waitress|waiting staff|"
                                 r"bar ?(staff|tender|person)|barista|hospitality|restaurant|hotel|housekeep\w*|"
                                 r"front of house|commis|pastry|food"),
    ("legal", r"solicitor|lawyer|paralegal|legal|conveyanc\w*|barrister|attorney|litigat\w*|law"),
    ("education", r"teach\w*|tutor|lecturer|school|nursery|early years|sen(co)?|education"),
    ("driving and logistics", r"driver|driving|hgv|lgv|courier|delivery|logistic\w*|warehouse|forklift|picker|packer"),
    ("construction and trades", r"electrician|plumb\w*|joiner|carpenter|labourer|builder|construction|bricklay\w*|"
                                r"site manager|surveyor|engineer|technician|mechanic|welder|painter|decorator"),
    ("office and finance", r"admin\w*|receptionist|secretar\w*|accountan\w*|account\w* (assistant|manager)|"
                           r"bookkeep\w*|payroll|finance|office|clerk|data entry|hr|human resources|recruit\w*"),
    ("IT and technology", r"developer|software|programmer|it support|devops|data (analyst|scientist|engineer)|"
                          r"network|cyber|web|tech\w*"),
    ("sales and customer service", r"sales|customer service|call cent(re|er)|retail|shop|store|cashier|account manager"),
    ("cleaning and facilities", r"clean\w*|janitor|caretaker|facilities|maintenance|security|guard"),
]


def category(title: str, description: str = "") -> Optional[str]:
    """The category of a role, or None when the words don't say."""
    for text in (title, description):
        low = " " + re.sub(r"[^a-z ]", " ", (text or "").lower()) + " "
        for name, words in CATEGORIES:
            if re.search(r"\b(" + words + r")\b", low):
                return name
    return None


def split_roles(listed: str) -> list:
    """"Nurse, Registered Manager, Chef and Solicitors" -> titles."""
    parts = re.split(r",|;|/|\band\b|\n|•|·", listed or "")
    out = []
    for p in parts:
        p = re.sub(r"^\W+|\W+$", "", p).strip()
        if p and len(p.split()) <= 4:
            out.append(re.sub(r"(?<=[a-z]{3})s$", "", p))      # "Solicitors" -> "Solicitor"
    return out


def same_category(job: dict, roles: list) -> tuple:
    """(category, roles in it, roles outside it) for the job being called about."""
    cat = category(job.get("job_title") or "", job.get("job_description") or "")
    inside, outside = [], []
    own = (job.get("job_title") or "").strip().lower()
    for r in dict.fromkeys(r for r in roles if r):
        if r.strip().lower() == own:
            continue
        (inside if cat and category(r) == cat else outside).append(r)
    return cat, inside, outside


def mentions(text: str, roles: list) -> list:
    """The roles in `roles` that `text` names ("chef", "chefs")."""
    low = " " + re.sub(r"[^a-z ]", " ", (text or "").lower()) + " "
    return [r for r in roles if re.search(r"\b" + re.escape(r.lower()) + r"(s|es)?\b", low)]
