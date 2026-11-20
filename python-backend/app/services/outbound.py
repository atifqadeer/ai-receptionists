"""
Outbound job calls - the AI agent calls an applicant about a matching job.

Applicants with their job arrive from the recruitment CRM's webhook or from
an uploaded CSV. Each becomes a queued call. The dialer places the call
through the VoIP provider (automatically within calling hours, or when you
press Call), the agent presents the job - title, salary, benefits, required
qualifications and experience - answers the applicant's questions from the
job data and the knowledge base, and records the outcome (interested, not
interested, call back, do not call). The outcome can be sent back to the
CRM through the result webhook.

Calls are stored in MySQL (calls "outbound_calls").
"""

import asyncio
import csv
import io
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from app.core import store
from app.services import call_rules
from app.services import telephony
from app.services.knowledge import KnowledgeBase
from app.services import company_facts
from app.services import call_intents, dnc, language_settings
from app.services import chat_language

_lock = asyncio.Lock()

# Builds the agent's side of a call (CallConversation) for a call record.
# Set at startup in main.py, where the agent and its knowledge live.
conversation_factory = None

# Fields stored for each applicant and job. The webhook may send any of
# them; the CSV template below uses a shorter, friendlier set.
FIELDS = [
    "applicant_id", "first_name", "last_name", "phone", "email",
    "job_id", "job_title", "employer", "location", "salary", "benefits",
    "qualifications", "experience", "job_type", "working_hours", "start_date",
    "job_description", "notes",
]
# CSV template: (column header, field). "Office" is the employer and
# "Branch" the job's location; "Applicant Name" is split into first and
# last name when read.
TEMPLATE = [
    ("Applicant Name", "name"), ("Phone", "phone"), ("Email", "email"),
    ("Job Title", "job_title"), ("Office", "employer"), ("Branch", "location"),
    ("Salary", "salary"), ("Benefits", "benefits"), ("Qualifications", "qualifications"),
    ("Experience", "experience"), ("Job Type", "job_type"), ("Working Hours", "working_hours"),
    ("Job Description", "job_description"),
]
TEMPLATE_EXAMPLE = [
    "Sarah Jones", "07700 900123", "sarah@example.com",
    "Registered Nurse (RGN)", "Oakwood Care Home", "Manchester",
    "£38,000 per year", "28 days holiday, pension, paid training", "Active NMC registration and PIN",
    "At least 2 years in elderly care", "Full-time, permanent", "Day shifts, 37.5 hours a week",
    "Caring for 30 elderly residents in a nursing home",
]

# Other names CRMs use for the same fields.
_ALIASES = {
    "first_name": ["firstname", "first", "given_name", "forename"],
    "last_name": ["lastname", "last", "surname", "family_name"],
    "name": ["full_name", "fullname", "applicant_name", "candidate_name", "contact_name"],
    "phone": ["phone_number", "mobile", "mobile_number", "telephone", "tel", "contact_number", "cell"],
    "email": ["email_address", "mail"],
    "applicant_id": ["candidate_id", "contact_id", "lead_id"],
    "job_id": ["vacancy_id", "position_id"],
    "job_title": ["title", "position", "role", "vacancy", "job", "job_name", "vacancy_title"],
    "employer": ["office", "office_name", "company", "client", "employer_name", "company_name", "client_name"],
    "location": ["branch", "branch_name", "city", "job_location", "address", "town"],
    "salary": ["pay", "pay_rate", "wage", "rate", "salary_range", "compensation"],
    "benefits": ["perks", "benefit"],
    "qualifications": ["required_qualifications", "qualification", "requirements", "required_qualification"],
    "experience": ["required_experience", "experience_required", "years_experience"],
    "job_type": ["employment_type", "employmenttype", "contract_type", "contracttype", "contract", "type"],
    "working_hours": ["hours", "workinghours", "shift", "shifts", "schedule", "working_pattern"],
    "start_date": ["start", "startdate", "available_from", "availablefrom"],
    "job_description": ["description", "jobdescription", "duties", "responsibilities", "summary", "job_summary"],
}

_FINAL = {"completed", "no_answer", "busy", "failed", "cancelled",
          "dnc", "not_interested", "wrong_number", "callback", "hung_up", "dropped"}


def _norm_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(k).strip().lower()).strip("_")


def normalize_record(raw: dict) -> dict:
    """One applicant + job from a webhook payload or CSV row, with CRM
    field names mapped to ours. Nested {"applicant": {...}, "job": {...}}
    payloads are flattened first."""
    flat = {}
    for k, v in (raw or {}).items():
        if isinstance(v, dict):
            for k2, v2 in v.items():
                flat.setdefault(_norm_key(k2), v2)
                flat[_norm_key(f"{k}_{k2}")] = v2
        else:
            flat[_norm_key(k)] = v
    out = {}
    for field in set(FIELDS) | {"name"}:
        for key in [field] + _ALIASES.get(field, []) + [f"job_{field}", f"applicant_{field}", f"candidate_{field}"]:
            val = flat.get(key)
            if val not in (None, ""):
                out[field] = ", ".join(map(str, val)) if isinstance(val, list) else str(val).strip()
                break
    if not out.get("first_name") and out.get("name"):
        parts = out["name"].split()
        out["first_name"] = parts[0]
        out.setdefault("last_name", " ".join(parts[1:]))
    out.pop("name", None)
    return out


def parse_csv(content: bytes) -> list:
    text = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    reader = csv.DictReader(io.StringIO(text or ""))
    return [normalize_record(row) for row in reader if any((v or "").strip() for v in row.values())]


def template_csv() -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([header for header, _ in TEMPLATE])
    w.writerow(TEMPLATE_EXAMPLE)
    return buf.getvalue()


# ---- storage ----

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> list:
    try:
        return store.load_list("outbound_calls")
    except Exception as e:
        logger.warning(f"Could not read outbound calls: {e}")
    return []


def _save(calls: list) -> None:
    store.save_list("outbound_calls", calls)


def list_calls() -> list:
    return sorted(_load(), key=lambda c: c.get("created_at", ""), reverse=True)


def get_call(call_id: str) -> Optional[dict]:
    return next((c for c in _load() if c["id"] == call_id), None)


async def update_call(call_id: str, **changes) -> Optional[dict]:
    async with _lock:
        calls = _load()
        for c in calls:
            if c["id"] == call_id:
                c.update(changes)
                c["updated_at"] = _now()
                _save(calls)
                return c
    return None


async def add_records(records: list, source: str) -> dict:
    """Queue a call per record. Records without a valid phone number or a
    job title are rejected; a record already queued (same applicant and
    job, or same phone and job title) is skipped."""
    settings = telephony.load_settings()
    added, skipped, rejected = [], [], []
    async with _lock:
        calls = _load()
        for i, rec in enumerate(records, start=1):
            phone = telephony.normalize_phone(rec.get("phone", ""), settings["default_country_code"])
            if not phone or not rec.get("job_title"):
                rejected.append({"row": i, "reason": "missing or invalid phone" if not phone else "missing job_title",
                                 "name": f"{rec.get('first_name', '')} {rec.get('last_name', '')}".strip()})
                continue
            if dnc.contains(phone):
                rejected.append({"row": i, "reason": "on the Do Not Call list",
                                 "name": f"{rec.get('first_name', '')} {rec.get('last_name', '')}".strip()})
                continue
            dup = next((c for c in calls if c["status"] not in _FINAL and (
                (rec.get("applicant_id") and rec.get("job_id") and c["applicant"].get("applicant_id") == rec.get("applicant_id")
                 and c["job"].get("job_id") == rec.get("job_id"))
                or (c["applicant"]["phone"] == phone and c["job"].get("job_title", "").lower() == rec["job_title"].lower()))), None)
            if dup:
                skipped.append({"row": i, "id": dup["id"], "reason": "already queued"})
                continue
            call = {
                "id": uuid.uuid4().hex,
                "source": source,
                "applicant": {k: rec.get(k, "") for k in ("applicant_id", "first_name", "last_name", "email", "notes")} | {"phone": phone},
                "job": {k: rec.get(k, "") for k in FIELDS if k not in ("applicant_id", "first_name", "last_name", "phone", "email", "notes")},
                "status": "queued",
                "outcome": None,
                "attempts": 0,
                "next_attempt_at": None,
                "dial_requested": False,
                "provider_call_id": None,
                "transcript": [],
                "state": {},
                "error": None,
                "created_at": _now(),
                "updated_at": _now(),
            }
            calls.append(call)
            added.append(call["id"])
        _save(calls)
    logger.info(f"Outbound: {len(added)} queued from {source}, {len(skipped)} duplicates, {len(rejected)} rejected")
    return {"added": len(added), "skipped": skipped, "rejected": rejected, "ids": added}


# ---- pulling applicants from the CRM's API ----

_crm_lock = asyncio.Lock()


def _crm_state() -> dict:
    try:
        return store.get_doc("crm_import") or {"imported": [], "last": None}
    except Exception as e:
        logger.warning(f"Could not read the CRM import state: {e}")
        return {"imported": [], "last": None}


def crm_status() -> dict:
    st = _crm_state()
    return {"last": st.get("last"), "imported_total": len(st.get("imported", []))}


def _crm_items(body) -> list:
    """The applicants array in a CRM response: a bare list, or the first
    list under data / applicants / records / items / results / candidates."""
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for key in ("data", "applicants", "records", "items", "results", "candidates"):
            if isinstance(body.get(key), list):
                return body[key]
            if isinstance(body.get(key), dict):   # {"data": {"applicants": [...]}}
                inner = _crm_items(body[key])
                if inner:
                    return inner
    return []


async def pull_from_crm() -> dict:
    """Fetch applicants from the CRM API and queue a call for each one not
    imported before (remembered by applicant + job id, or phone + job
    title, so a finished call is not queued again on the next pull)."""
    settings = telephony.load_settings()
    url = (settings.get("crm_api_url") or "").strip()
    if not url:
        raise ValueError("Set the CRM API URL first (Settings > Calling > Webhooks).")
    headers = {"Accept": "application/json"}
    key = (settings.get("crm_api_key") or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
        headers["X-API-Key"] = key
    async with _crm_lock:
        started = _now()
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(url, headers=headers)
            if r.status_code >= 400:
                detail = (r.text or "")[:200]
                raise ValueError(f"The CRM answered {r.status_code}: {detail}")
            items = _crm_items(r.json())
        except httpx.HTTPError as e:
            raise ValueError(f"Could not reach the CRM at {url}: {e}") from e
        except json.JSONDecodeError as e:
            raise ValueError("The CRM did not return JSON.") from e

        st = _crm_state()
        seen = set(st.get("imported", []))
        records, keys, already = [], [], 0
        for raw in items:
            if not isinstance(raw, dict):
                continue
            rec = normalize_record(raw)
            if not rec.get("applicant_id") and raw.get("id") not in (None, ""):
                rec["applicant_id"] = str(raw["id"])
            ident = (f"{rec.get('applicant_id', '')}|{rec.get('job_id', '')}" if rec.get("applicant_id")
                     else f"{rec.get('phone', '')}|{(rec.get('job_title') or '').lower()}")
            if ident in seen:
                already += 1
                continue
            records.append(rec)
            keys.append(ident)
        result = await add_records(records, source="crm") if records else {"added": 0, "skipped": [], "rejected": [], "ids": []}
        rejected_rows = {x["row"] for x in result["rejected"]}
        for i, ident in enumerate(keys, start=1):
            if i not in rejected_rows:      # rejected ones are retried once the CRM fixes them
                seen.add(ident)
        summary = {"at": started, "url": url, "fetched": len(items), "added": result["added"],
                   "already_imported": already + len(result["skipped"]), "rejected": result["rejected"]}
        st.update(imported=sorted(seen), last=summary)
        store.put_doc("crm_import", st)
    logger.info(f"CRM pull: {len(items)} fetched, {result['added']} queued, {summary['already_imported']} already imported, "
                f"{len(result['rejected'])} rejected")
    return summary


async def _maybe_pull_crm() -> None:
    """The dialer loop's periodic pull, every crm_poll_minutes."""
    settings = telephony.load_settings()
    minutes = int(settings.get("crm_poll_minutes") or 0)
    if minutes <= 0 or not (settings.get("crm_api_url") or "").strip():
        return
    last = (_crm_state().get("last") or {}).get("at")
    if last and (datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds() < minutes * 60:
        return
    try:
        await pull_from_crm()
    except ValueError as e:
        logger.warning(f"CRM pull failed: {e}")
        st = _crm_state()
        st["last"] = {"at": _now(), "url": settings.get("crm_api_url"), "error": str(e)}
        store.put_doc("crm_import", st)


async def delete_call(call_id: str) -> bool:
    async with _lock:
        calls = _load()
        kept = [c for c in calls if c["id"] != call_id]
        if len(kept) == len(calls):
            return False
        _save(kept)
        return True


async def request_dial(call_ids: Optional[list] = None) -> int:
    """Manual "Call" / "Call all queued": the dialer places these calls on
    its next pass, regardless of call mode and calling hours."""
    n = 0
    async with _lock:
        calls = _load()
        for c in calls:
            if (call_ids is None or c["id"] in call_ids) and c["status"] in ("queued", "no_answer", "busy", "failed", "hung_up", "callback"):
                c["status"] = "queued"
                c["dial_requested"] = True
                c["next_attempt_at"] = None
                n += 1
        _save(calls)
    return n


# ---- what the agent says ----

def _clean(v: str) -> str:
    return re.sub(r"\s+", " ", (v or "").strip()).rstrip(".")


def opening_pitch(call: dict, agent_name: str, company: str) -> str:
    a, j = call["applicant"], call["job"]
    name = a.get("first_name") or "there"
    parts = [f"Hello {name}, this is {agent_name} calling from {company}."]
    where = f" in {_clean(j['location'])}" if j.get("location") else ""
    employer = ""  # given when asked ("who is the employer?"), to keep the opening short
    # Kept short (about 12 seconds): benefits, requirements and hours are
    # given when the applicant asks, so they can join in sooner.
    parts.append(f"We have a {_clean(j['job_title'])} position{employer}{where} that matches your experience.")
    if j.get("salary"):
        parts.append(f"The salary is {_clean(j['salary'])}.")
    parts.append("Would you be interested in this position?")
    return " ".join(parts)


_PATTERNS = [
    ("repeat", r"\b(repeat|say (that|it) again|pardon|didn'?t (hear|catch)|come again|what did you say)\b|^\W*(sorry|what|huh|eh)\W*(what|sorry)?\W*$"),
    ("hello", r"^\W*(hello|hi|hey|hiya)\W*(hello|hi|there)?\W*$|\b(are you (still )?there|can you hear me)\b"),
    ("identity", r"\b(who (is this|are you|is calling)|where are you calling from|what company|are you (a |an )?(robot|bot|real|human|person|machine|computer|ai))\b"),
    ("hold", r"\b(hold on|wait a (second|sec|minute|moment)|one (second|sec|minute|moment)|just a (second|sec|minute|moment)|give me a (second|sec|minute|moment))\b|^\W*wait\W*$"),
    ("how_number", r"\b(how did you get|where did you get) (my|this) (number|details)\b"),
    *[(name, pat) for name, pat in company_facts.PATTERNS.items()],
    ("identity", r"\b(who (is this|are you|is calling)|where are you calling from|what company|are you (a |an )?(robot|bot|real|human|person|machine|computer|ai))\b"),
    ("hold", r"\b(hold on|wait a (second|sec|minute|moment)|one (second|sec|minute|moment)|just a (second|sec|minute|moment)|give me a (second|sec|minute|moment))\b|^\W*wait\W*$"),
    ("how_number", r"\b(how did you get|where did you get) (my|this) (number|details)\b"),
    ("company_name", r"\b(name of (your|the|this) (company|agency|organi[sz]ation|firm|business)|(your|the) (company|agency)'?s? name|"
                     r"what('?s| is) (your|the) (company|agency)( called| name|\W*$)|which (company|agency) (is (this|it)|are you( from)?)|"
                     r"what (company|agency) (is (this|it)|are you( from)?)|who do you work for|company name)\b"),
    ("roles", r"\b((what|which) (other |kind of |type of |types of )?(roles|jobs|positions|vacancies|posts|opportunities)|"
              r"(roles|jobs|positions|vacancies) (are|do|does|did) (you|your company|the company)|"
              r"(roles|jobs|positions|vacancies|services) (that )?(you|your company|the company) (are |is )?(provid|offer|hir|recruit|ha(ve|s))\w*|"
              r"what (is|are) the (roles|jobs|positions|vacancies)|"
              r"(any|other|more) (roles|jobs|positions|vacancies|opportunities)|"
              r"what (do|does) (you|your company|the company|your agency) (do|recruit|provide|offer|hire)|"
              r"(recruit|hire|hiring|recruiting) for)\b"),
    ("company_address", r"\b((your|the|company|office|agency)('?s)? (address|office|head office)|address of (your|the) (company|office|agency)|"
                        r"where (is|are) (your|the) (office|company|agency|business)|where are you (based|located)|company address)\b"),
    ("company_contact", r"\b((your|the|company'?s?|office|agency) (phone|telephone|contact|email|e-mail)( number| address| details)?|"
                        r"how (can|do|could) i (contact|reach|call|email|get (hold|in touch)( of| with)?) (you|the company|your (team|office)))\b"),
    ("office_hours", r"\b((office|opening|business|working) hours of (the|your) (company|office)|(your|the) (office|opening|business) hours|"
                     r"when (is|are) (your|the) (office|company) open|when are you open)\b"),
    ("salary", r"\b(salary|pay|paid|wage|rate|money|earn|how much)\b"),
    ("benefits", r"\b(benefit|perk|holiday|pension|bonus)\w*"),
    ("location", r"\b(where|location|located|address|area|city|commute)\b"),
    ("qualifications", r"\b(qualification|requirement|require|need to have|certificate|registration|nmc|cqc|licen[cs]e)\w*"),
    ("experience", r"\b(experience|years)\b"),
    ("hours", r"\b(hours|shift|shifts|schedule|days|nights|weekend|rota|working pattern)\b"),
    ("job_type", r"\b(full[- ]?time|part[- ]?time|permanent|temporary|contract|temp)\b"),
    ("start", r"\b(start|starting|when (does|would|can) (it|i))\b"),
    ("duties", r"\b(dut(y|ies)|responsibilit\w*|what (does|is) the (job|role)|tell me (more|about)|description|day to day)\b"),
    ("employer", r"\b(employer|which company|who is the (client|employer)|who would i (be )?work(ing)? for)\b"),
    ("interested", r"\b(yes|yeah|yep|sure|interested|sounds (good|great)|i'?d (like|love)|go ahead|apply|definitely|absolutely|of course|okay|ok)\b"),
    ("goodbye", r"\b(bye|goodbye|that'?s all|nothing else|no more questions|no that'?s it)\b"),
    ("thanks", r"\b(thank you|thanks|cheers)\b"),
]


def _classify(text: str) -> list:
    low = text.lower()
    return [name for name, pat in _PATTERNS if re.search(pat, low)]


# ---- guard rails: the agent only talks about the job and the company ----

_QUESTION_WORDS = {"what", "how", "can", "could", "do", "does", "did", "is", "are", "which", "who",
                   "where", "when", "why", "will", "would", "should", "tell", "explain", "any", "may"}

# Subjects the agent must not answer, whatever the knowledge base says.
_OFF_TOPIC = re.compile(
    r"\b(weather|forecast|joke|funny|football|soccer|cricket|rugby|tennis|premier league|"
    r"politic\w*|election|president|prime minister|religio\w*|"
    r"bitcoin|crypto\w*|stock market|lottery|casino|gambling|"
    r"movie|film|tv show|netflix|song|music|singer|celebrity|"
    r"capital of|math\w*|homework|recipe|"
    r"the news|girlfriend|boyfriend|date me|marry me|how old are you|"
    r"medical advice|diagnos\w*|legal advice|lawyer|"
    r"write (me )?(a|an) (poem|essay|story|code)|poem|essay)\b", re.I)

# Words that keep a question on topic: the job, applying, the agency.
_ON_TOPIC = {
    "job", "jobs", "role", "roles", "position", "positions", "vacancy", "vacancies", "work", "working",
    "worker", "career", "interview", "cv", "resume", "apply", "application", "applying", "recruiter",
    "recruitment", "recruiting", "agency", "company", "employer", "client", "contract", "salary", "pay",
    "wage", "rate", "hours", "shift", "shifts", "rota", "holiday", "holidays", "leave", "overtime",
    "pension", "bonus", "benefits", "training", "induction", "uniform", "dbs", "visa", "sponsorship",
    "sponsor", "right", "references", "reference", "documents", "passport", "certificate", "qualification",
    "qualifications", "experience", "requirements", "start", "probation", "notice", "travel", "parking",
    "transport", "accommodation", "location", "team", "manager", "staff", "patients", "residents",
    "care", "hospital", "home", "nhs", "permanent", "temporary", "temp", "full", "part", "time", "weekend",
    "nights", "days", "duties", "responsibilities", "next", "step", "steps", "process", "number",
    "details", "call", "calling", "email", "contact", "office", "address",
}


# Clearly about the job even when an off-topic word appears
# ("does the weather affect the shifts?").
_STRONG_ON_TOPIC = {"job", "role", "position", "salary", "pay", "shift", "shifts", "hours", "interview",
                    "cv", "apply", "application", "contract", "training", "work", "working", "recruiter"}


def _words(text: str) -> set:
    return set(re.findall(r"[a-z']+", (text or "").lower()))


def is_question(text: str) -> bool:
    w = re.findall(r"[a-z']+", (text or "").lower())
    return "?" in (text or "") or bool(w and w[0] in _QUESTION_WORDS) or \
        bool(re.search(r"\b(i (want|would like|wanted) to (know|ask)|can i ask|i have a question)\b", (text or "").lower()))


def on_topic_words(job: dict, company: str) -> set:
    """Words that make a question about this job or this company."""
    words = set(_ON_TOPIC) | _words(company)
    for key in ("job_title", "employer", "location", "job_type"):
        words |= {w for w in _words(job.get(key, "")) if len(w) > 2}
    return words


class CallConversation:
    """The agent's side of one outbound job call."""

    MAX_TURNS = 30  # questions asked over the agent count as turns too

    def __init__(self, call: dict, agent_name: str, company: str, knowledge: Optional[KnowledgeBase] = None,
                 contact: str = "", profile: Optional[dict] = None, think=None):
        """profile: the company details from Agent Setup (address, phone,
        email, business_hours, services). think(question, situation,
        history) -> str or None: the AI model's own answer, for questions
        no rule or knowledge passage covers."""
        self.profile = profile or {}
        self.think = think
        self.call = call
        self.job = call["job"]
        self.state = call.setdefault("state", {})
        self.agent_name = agent_name
        self.company = company
        self.knowledge = knowledge
        self.contact = contact

    def opening(self) -> str:
        return opening_pitch(self.call, self.agent_name, self.company)

    def _field(self, key: str, sentence: str) -> Optional[str]:
        v = self.job.get(key)
        return sentence.format(_clean(v)) if v else None

    def _job_answer(self, intent: str) -> Optional[str]:
        j = self.job
        if intent == "salary":
            return self._field("salary", "The salary is {}.") or "The salary depends on the employer; our recruiter will confirm the exact figure with you."
        if intent == "benefits":
            return self._field("benefits", "The benefits include {}.")
        if intent == "location":
            return self._field("location", "The job is in {}.")
        if intent == "qualifications":
            return self._field("qualifications", "The required qualifications are {}.")
        if intent == "experience":
            return self._field("experience", "The experience required is {}.")
        if intent == "hours":
            return self._field("working_hours", "The working hours are {}.")
        if intent == "job_type":
            return self._field("job_type", "This is a {} position.")
        if intent == "start":
            return self._field("start_date", "The expected start date is {}.")
        if intent == "duties":
            return self._field("job_description", "{}.") or self._field("job_title", "It's a {} role; our recruiter can share the full job description with you.")
        if intent == "employer":
            return self._field("employer", "The employer is {}.") or "Our recruiter will share the employer's details with you at the next stage."
        if intent == "identity":
            return f"This is {self.agent_name}, an AI assistant calling from {self.company} about a {_clean(j['job_title'])} position."
        if intent == "company_name":
            return f"I'm calling from {self.company}."
        if intent == "roles":
            roles = self.knowledge.roles() if self.knowledge else []
            listed = self.profile.get("services") or ""
            if roles:
                listed = ", ".join(roles[:-1]) + " and " + roles[-1] if len(roles) > 1 else roles[0]
            if listed:
                return (f"{self.company} recruits for {_clean(listed)}. Right now I'm calling about the "
                        f"{_clean(j['job_title'])} position.")
            return f"Today I'm calling about the {_clean(j['job_title'])} position; our recruiter can tell you about our other roles."
        if intent == "company_address":
            a = self.profile.get("address")
            return f"Our office address is {_clean(a)}." if a else "Our recruiter will send you our office address."
        if intent == "company_contact":
            phone, email = self.profile.get("phone"), self.profile.get("email")
            parts = [f"call us on {_clean(phone)}" if phone else "", f"email us at {email.strip()}" if email else ""]
            parts = [x for x in parts if x]
            return ("You can " + " or ".join(parts) + ".") if parts else "Our recruiter will give you our contact details."
        if intent == "office_hours":
            h = self.profile.get("business_hours")
            return f"Our office hours are {_clean(h)}." if h else None
        if intent == "how_number":
            return f"Your details are registered with {self.company} as a job applicant, which is why we're calling about this role."
        return None

    def reply(self, text: str, interrupted: bool = False) -> tuple:
        """(what the agent says, end the call?) for the applicant's words.
        Sets call["outcome"] when the applicant decides, and keeps a note
        of every applicant response (question, answer, decision) in
        call["notes"]. `interrupted`: the applicant spoke over the agent."""
        text = (text or "").strip()
        said, end, kind = self._reply(text)
        if text:
            self.call.setdefault("notes", []).append({
                "at": _now(), "kind": kind, "applicant": text, "agent": said, "interrupted": bool(interrupted)})
        return said, end

    def unclear(self, text: str, interrupted: bool = False) -> str:
        """The recogniser wasn't sure what the applicant said: ask again
        instead of answering a guess. Noted, so the recruiter sees it."""
        st = self.state
        st["unclear"] = st.get("unclear", 0) + 1
        said = ("Sorry, the line isn't very clear. Could you say that again?" if st["unclear"] % 2 == 1
                else "Sorry, I still didn't catch that. Could you say it again, a little slower?")
        self.call.setdefault("notes", []).append({
            "at": _now(), "kind": "unclear", "applicant": text, "agent": said, "interrupted": bool(interrupted)})
        return said

    def _off_topic(self, text: str) -> bool:
        return bool(_OFF_TOPIC.search(text)) and not (_words(text) & _STRONG_ON_TOPIC)

    def _thought(self, text: str) -> Optional[str]:
        """The AI model's own answer to a question nothing else answers."""
        if not self.think:
            return None
        j = self.job
        situation = (f"You are on a phone call with {self.call['applicant'].get('first_name') or 'a job applicant'}, "
                     f"telling them about a {_clean(j.get('job_title'))} position"
                     + (f" in {_clean(j['location'])}" if j.get("location") else "")
                     + ". Job details: " + "; ".join(f"{k.replace('_', ' ')}: {_clean(v)}" for k, v in j.items() if v) + ".")
        history = []
        for n in (self.call.get("notes") or [])[-3:]:
            history += [{"role": "user", "content": n.get("applicant", "")}, {"role": "assistant", "content": n.get("agent", "")}]
        return self.think(text, situation, history)

    def _refuse(self, follow: str) -> str:
        self.state["off_topic"] = self.state.get("off_topic", 0) + 1
        title = _clean(self.job.get("job_title")) or "job"
        return (f"That's a bit outside what I can help with on this call, but I'm happy to answer anything about "
                f"this {title} position or {self.company}. {follow}")

    def _reply(self, text: str) -> tuple:
        """(what the agent says, end the call?, note kind)."""
        st = self.state
        st["turns"] = st.get("turns", 0) + 1
        follow = "Is there anything else you'd like to know?" if self.call.get("outcome") == "interested" \
            else "Would you be interested in this position?"

        if not text:
            st["silence"] = st.get("silence", 0) + 1
            if st["silence"] >= 2:
                self.call["outcome"] = self.call.get("outcome") or "no_response"
                return "It seems this isn't a good time. We'll be in touch again. Goodbye.", True, "silence"
            return "Sorry, I didn't catch that. " + follow, False, "silence"
        st["silence"] = 0
        intents = _classify(text)
        question = is_question(text)
        # "Where are you calling from" / "where did you get my number" are
        # about the call, not the job's location.
        for only in ("how_number", "company_address", "company_contact", "office_hours", "roles", "company_name", "identity"):
            if only in intents:
                intents = [only]
                break

        decided = self._decision(text, follow)
        if decided:
            return decided
        if "hold" in intents and not question:
            st["silence"] = -1  # one extra quiet turn while they're away
            return "Of course, take your time. I'm still here.", False, "response"
        if "repeat" in intents:
            return st.get("last_said") or self.opening(), False, "response"
        if "hello" in intents and len(intents) == 1:
            return "Yes, I'm here. " + follow, False, "response"

        # Not about the job: the AI model thinks up a short answer itself,
        # then the call goes back to the job.
        if self._off_topic(text):
            thought = self._thought(text)
            if thought:
                return self._finish(thought + " " + follow, follow, "off_topic")
            return self._finish(self._refuse(follow), follow, "off_topic")

        answers = [a for a in (self._job_answer(i) for i in intents) if a]
        if answers:
            return self._finish(" ".join(dict.fromkeys(answers[:2])) + " " + follow, follow, "question")
        if "interested" in intents and self.call.get("outcome") != "interested" and not question:
            self.call["outcome"] = "interested"
            said = ("Wonderful. I've noted that you're interested. A recruiter from our team will contact you "
                    "shortly to arrange the next steps. Is there anything you'd like to know about the role?")
            return self._finish(said, follow, "decision")
        decided = self.call.get("outcome") == "interested"
        if not question and ("goodbye" in intents or (decided and "thanks" in intents) or
                             (decided and re.fullmatch(r"\W*(no|nope|nah|no thanks?)\W*", text.lower()))):
            name = self.call["applicant"].get("first_name") or ""
            return f"Thank you for your time, {name}. Goodbye.".replace(" .", "."), True, "response"
        if "thanks" in intents and not question:
            return self._finish("You're welcome. " + follow, follow, "response")

        kb_answer = self.knowledge.search(text) if self.knowledge else None
        if kb_answer:
            return self._finish(kb_answer + " " + follow, follow, "question")
        on_topic = bool(_words(text) & on_topic_words(self.job, self.company))
        if question or len(_words(text)) > 3:
            thought = self._thought(text)
            if thought:
                return self._finish(thought + " " + follow, follow, "question" if on_topic else "off_topic")
        if on_topic:
            said = "That's a good question. I'll ask our recruiter to answer that when they contact you. " + follow
            return self._finish(said, follow, "unanswered")
        if question or len(_words(text)) > 3:
            return self._finish(self._refuse(follow), follow, "off_topic")
        return self._finish("Sorry, I didn't quite get that. " + follow, follow, "response")

    def _decision(self, text: str, follow: str) -> Optional[tuple]:
        """The applicant's decision (see call_intents): don't call again,
        not interested, wrong number, voicemail, call back, ... Returns
        (said, end, kind), or None to carry on with the conversation."""
        st = self.state
        interested = self.call.get("outcome") == "interested"
        asked = chat_language.requested(text)
        allowed = language_settings.allowed("calls", ai_model=bool(self.think))
        if asked and asked not in allowed:
            return (f"I'm sorry, I can only speak {language_settings.names(allowed)} on this call. {follow}",
                    False, "response")
        decision = call_intents.detect(text, allow_voicemail=st.get("turns", 0) <= 2)
        # A plain "no" answers "Would you be interested in this position?"
        if decision is None and not interested and call_intents.is_bare_no(text):
            decision = "not_interested"
        name = self.call["applicant"].get("first_name") or ""
        bye = f"Thank you for your time, {name}. Goodbye.".replace(" ,", ",").replace(", .", ".")
        if decision == "do_not_call":
            self.call["outcome"] = "do_not_call"
            return ("I completely understand, and I'm sorry for disturbing you. I've added your number to our "
                    "do-not-call list, so you won't be contacted again. Goodbye."), True, "decision"
        if decision == "voicemail":
            self.call["outcome"] = "voicemail"
            title = _clean(self.job.get("job_title")) or "job"
            return (f"Hello{' ' + name if name else ''}, this is {self.agent_name} from {self.company}, calling about a "
                    f"{title} position that matches your experience. We'll try you again later. Goodbye."), True, "decision"
        if decision == "wrong_number":
            self.call["outcome"] = "wrong_number"
            return ("I'm so sorry about that, I must have the wrong details. I'll update our records so you're not "
                    "called again about this. Have a good day. Goodbye."), True, "decision"
        if decision == "end_call":
            if not interested:
                self.call["outcome"] = "end_call"
            return "Of course. " + bye, True, "decision"
        if decision == "abusive":
            self.call["outcome"] = self.call.get("outcome") or "abusive"
            return "I'm sorry you feel that way. I'll end the call here. Goodbye.", True, "decision"
        if decision == "callback":
            when = call_intents.callback_when(text)
            if when:
                self.call["callback_when"] = when
            if interested:       # keep their yes; the recruiter calls them anyway
                return "Of course. Our recruiter will be in touch with you soon. Goodbye.", True, "decision"
            self.call["outcome"] = "callback"
            return (f"No problem at all. We'll call you back {when}. Goodbye." if when else
                    "No problem at all. We'll call you back at a better time. Goodbye."), True, "decision"
        if decision == "not_interested":
            # Once interested, "no thanks" means "no more questions", not a change of mind.
            if interested and not re.search(r"\b(not (really |at all )?interested|not looking|already|pass|not for me|"
                                            r"changed my mind|don'?t want|retired)\b", call_intents.normalize(text)):
                return bye, True, "response"
            self.call["outcome"] = "not_interested"
            return ("No problem at all, thank you for letting me know. I've noted that you're not interested in this "
                    "role. Have a great day. Goodbye."), True, "decision"
        if decision == "unsure" and not interested:
            st["unsure"] = st.get("unsure", 0) + 1
            if st["unsure"] == 1:
                return self._finish("That's completely fine, there's no pressure at all. Would it help if I told you a "
                                    "bit more, like the hours, the pay or the location?", follow, "response")
            self.call["outcome"] = "undecided"
            self.call["send_details"] = True
            return ("No problem. I'll ask our recruiter to send you the details so you can decide in your own time. "
                    + bye), True, "decision"
        if decision == "send_details":
            self.call["send_details"] = True
            return self._finish("Of course. I'll ask our recruiter to send you the full details. " + follow,
                                follow, "response")
        return None

    def _finish(self, said: str, follow: str, kind: str) -> tuple:
        # The same answer twice in a row means we probably misheard the
        # question: say so rather than repeating ourselves.
        if kind == "question" and said == self.state.get("last_said"):
            said = "I think I may have misheard you. Could you ask that another way? " + follow
            kind = "unclear"
        if self.state["turns"] >= self.MAX_TURNS:
            return said.replace(follow, "").strip() + " Our recruiter will follow up with you. Goodbye.", True, kind
        self.state["last_said"] = said
        return said, False, kind


# ---- dialer ----

def _due(call: dict, now: datetime) -> bool:
    nxt = call.get("next_attempt_at")
    return not nxt or datetime.fromisoformat(nxt) <= now


async def dial(call_id: str) -> dict:
    """Place one call through the VoIP provider."""
    settings = telephony.load_settings()
    call = get_call(call_id)
    if not call:
        raise telephony.TelephonyError("Call not found")
    if dnc.contains(call["applicant"]["phone"]):
        logger.info(f"Outbound call {call_id}: {call['applicant']['phone']} is on the Do Not Call list, not dialled")
        return await update_call(call_id, status="dnc", outcome="do_not_call", dial_requested=False)
    blocked = call_rules.check(call["applicant"]["phone"])
    if blocked:                 # Call Rules: wait (hang-up, not interested, daily limit)
        until, why = blocked
        logger.info(f"Outbound call {call_id}: {why}")
        return await update_call(call_id, status="queued", next_attempt_at=until.isoformat(), held_reason=why)
    call_rules.note_call(call["applicant"]["phone"])
    await update_call(call_id, status="dialing", attempts=call["attempts"] + 1, dial_requested=False, error=None,
                      last_attempt_at=_now(), scheduled_callback=False, held_reason=None)
    try:
        provider_id = await telephony.place_call(settings, call["applicant"]["phone"], call_id)
        return await update_call(call_id, provider_call_id=provider_id)
    except Exception as e:
        logger.warning(f"Outbound call {call_id} failed to start: {e}")
        return await update_call(call_id, status="failed", error=str(e))


async def dialer_pass() -> None:
    """Place the calls that are due: manual requests always; queued calls
    automatically when call mode is "auto" and it is within calling hours."""
    settings = telephony.load_settings()
    if not telephony.is_configured(settings):
        return
    calls = _load()
    active = sum(1 for c in calls if c["status"] in ("dialing", "ringing", "in_progress"))
    room = max(0, int(settings.get("max_concurrent_calls") or 1) - active)
    if room == 0:
        return
    now = datetime.now(timezone.utc)
    auto_ok = settings.get("call_mode") == "auto" and telephony.within_calling_hours(settings)
    in_hours = telephony.within_calling_hours(settings)
    due = [c for c in calls if c["status"] == "queued" and _due(c, now)
           and (c.get("dial_requested") or auto_ok or (c.get("scheduled_callback") and in_hours))]
    due.sort(key=lambda c: (not c.get("dial_requested"), c.get("created_at", "")))
    for c in due[:room]:
        await dial(c["id"])


async def dialer_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await _maybe_pull_crm()
        except Exception as e:
            logger.error(f"CRM pull error: {e}")
        try:
            await dialer_pass()
        except Exception as e:
            logger.error(f"Dialer error: {e}")
        try:
            await asyncio.wait_for(stop.wait(), timeout=10)
        except asyncio.TimeoutError:
            pass


async def finish_call(call_id: str, status: str) -> None:
    """Final status from the provider: schedule a retry for unanswered
    calls, and send the outcome to the CRM."""
    settings = telephony.load_settings()
    call = get_call(call_id)
    if not call:
        return
    changes = {"status": status, "ended_at": _now()}
    outcome = call.get("outcome")
    if status == "completed" and outcome == "voicemail":
        status = "no_answer"            # an answering machine: try again later, like no answer
        changes.update(status=status, last_result="voicemail")
    elif status == "completed" and outcome in call_intents.STATUS_FOR:
        changes["status"] = call_intents.STATUS_FOR[outcome]
    if outcome == "do_not_call":
        await _mark_do_not_call(call)
    rules = call_rules.get()
    phone = call["applicant"]["phone"]
    name = " ".join(x for x in (call["applicant"].get("first_name"), call["applicant"].get("last_name")) if x)
    call_rules.after_call(phone, changes["status"], call_id, name, call.get("outcome_said") or "")
    if status in ("no_answer", "busy") and call["attempts"] < int(settings.get("max_attempts") or 1):
        voicemail = changes.get("last_result") == "voicemail"
        wait = rules["voicemail_retry_minutes"] if voicemail else int(settings.get("retry_minutes") or 60)
        changes["status"] = "queued"
        changes["next_attempt_at"] = (datetime.now(timezone.utc) + timedelta(minutes=wait)).isoformat()
        changes["last_result"] = "voicemail" if voicemail else status
    # They asked to be called back: queue it for the time they said.
    if (changes["status"] == "callback" and rules["callback_enabled"]
            and int(call.get("callbacks") or 0) < rules["callback_max"]):
        at = call_rules.callback_at(call.get("callback_when") or "")
        changes.update(status="queued", next_attempt_at=at.isoformat(), scheduled_callback=True,
                       callbacks=int(call.get("callbacks") or 0) + 1, last_result="callback")
        logger.info(f"Outbound call {call_id}: calling back at {at.isoformat()} "
                    f"(they said {call.get('callback_when') or 'nothing specific'})")
    if status == "completed" and not call.get("outcome"):
        changes["outcome"] = "no_response" if not call.get("transcript") else "unknown"
    call = await update_call(call_id, **changes)
    if call and call["status"] in _FINAL:
        await send_result(call)


async def _mark_do_not_call(call: dict) -> None:
    """Put the number on the Do Not Call list and stop every other queued
    job call to it."""
    phone = call["applicant"]["phone"]
    said = next((n.get("applicant", "") for n in reversed(call.get("notes") or []) if n.get("kind") == "decision"), "")
    name = f"{call['applicant'].get('first_name', '')} {call['applicant'].get('last_name', '')}".strip()
    try:
        await asyncio.to_thread(dnc.add, phone, "job call", said, call["id"], name)
    except Exception as e:
        logger.warning(f"Could not add {phone} to the Do Not Call list: {e}")
    async with _lock:
        calls = _load()
        stopped = 0
        for c in calls:
            if c["id"] != call["id"] and c["status"] == "queued" and dnc.key(c["applicant"]["phone"]) == dnc.key(phone):
                c.update(status="dnc", outcome="do_not_call", updated_at=_now(), next_attempt_at=None)
                stopped += 1
        if stopped:
            _save(calls)
            logger.info(f"Do Not Call: {stopped} other queued call(s) to {phone} stopped")


_NOTE_LABEL = {"question": "Asked", "unanswered": "Asked (for the recruiter to answer)",
               "off_topic": "Off-topic (declined)", "decision": "Decision", "response": "Said", "silence": "Said",
               "unclear": "Unclear on the line (asked to repeat)"}


def notes_summary(call: dict) -> str:
    """The call notes as plain text, one line per applicant response."""
    lines = []
    for n in call.get("notes", []):
        label = _NOTE_LABEL.get(n.get("kind"), "Said")
        cut = " (interrupted the agent)" if n.get("interrupted") else ""
        lines.append(f"{label}{cut}: {n.get('applicant', '')}")
    return "\n".join(lines)


async def send_result(call: dict) -> None:
    url = (telephony.load_settings().get("result_webhook_url") or "").strip()
    if not url:
        return
    payload = {
        "event": "call.finished",
        "call_id": call["id"],
        "applicant_id": call["applicant"].get("applicant_id"),
        "job_id": call["job"].get("job_id"),
        "phone": call["applicant"]["phone"],
        "status": call["status"],
        "outcome": call.get("outcome"),
        "attempts": call["attempts"],
        "transcript": call.get("transcript", []),
        "notes": call.get("notes", []),
        "notes_summary": notes_summary(call),
        "finished_at": call.get("ended_at"),
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Authenticate to the CRM with the same key used to fetch applicants.
            key = (telephony.load_settings().get("crm_api_key") or "").strip()
            headers = {"Authorization": f"Bearer {key}", "X-API-Key": key} if key else {}
            r = await client.post(url, json=payload, headers=headers)
        await update_call(call["id"], result_sent=r.status_code < 300)
    except Exception as e:
        logger.warning(f"Could not send call result to CRM: {e}")
        await update_call(call["id"], result_sent=False)
