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

Calls are stored in data/outbound_calls.json.
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

from app.services import telephony
from app.services.knowledge import KnowledgeBase

_CALLS_FILE = Path(__file__).resolve().parents[2] / "data" / "outbound_calls.json"
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
    "job_type": ["employment_type", "contract_type", "contract", "type"],
    "working_hours": ["hours", "shift", "shifts", "schedule", "working_pattern"],
    "start_date": ["start", "available_from"],
    "job_description": ["description", "duties", "responsibilities", "summary", "job_summary"],
}

_FINAL = {"completed", "no_answer", "busy", "failed", "cancelled"}


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
        if _CALLS_FILE.exists():
            return json.loads(_CALLS_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"Could not read outbound calls: {e}")
    return []


def _save(calls: list) -> None:
    _CALLS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CALLS_FILE.write_text(json.dumps(calls, indent=2), encoding="utf-8")


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
            if (call_ids is None or c["id"] in call_ids) and c["status"] in ("queued", "no_answer", "busy", "failed"):
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
    ("do_not_call", r"\b(don'?t|do not|stop|never) (call|ring|contact)|remove (me|my number)|take me off"),
    ("callback", r"\b(call (me )?(back|later|tomorrow)|ring (me )?back|not a good time|bad time|busy right now|i'?m (driving|at work|busy)|can'?t talk)\b"),
    ("not_interested", r"\b(not interested|no thanks?|no thank you|not looking|already (found|got|have) a (job|position|role)|i'?ll pass|not for me)\b"),
    ("repeat", r"\b(repeat|say (that|it) again|pardon|didn'?t (hear|catch)|come again|what did you say)\b|^\W*(sorry|what|huh|eh)\W*(what|sorry)?\W*$"),
    ("hello", r"^\W*(hello|hi|hey|hiya)\W*(hello|hi|there)?\W*$|\b(are you (still )?there|can you hear me)\b"),
    ("identity", r"\b(who (is this|are you|is calling)|where are you calling from|what company|are you (a |an )?(robot|bot|real|human|person|machine|computer|ai))\b"),
    ("hold", r"\b(hold on|wait a (second|sec|minute|moment)|one (second|sec|minute|moment)|just a (second|sec|minute|moment)|give me a (second|sec|minute|moment))\b|^\W*wait\W*$"),
    ("how_number", r"\b(how did you get|where did you get) (my|this) (number|details)\b"),
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
                 contact: str = ""):
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

    def _refuse(self, follow: str) -> str:
        self.state["off_topic"] = self.state.get("off_topic", 0) + 1
        title = _clean(self.job.get("job_title")) or "job"
        return (f"I'm sorry, I can't answer that. I can only help with questions about this {title} "
                f"position and {self.company}. {follow}")

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
        for only in ("how_number", "identity"):
            if only in intents:
                intents = [only]

        if "do_not_call" in intents:
            self.call["outcome"] = "do_not_call"
            return "I understand. I'll make sure you're not called about this again. Goodbye.", True, "decision"
        if "callback" in intents:
            self.call["outcome"] = "callback"
            return "No problem at all. We'll call you back at a better time. Goodbye.", True, "decision"
        # Once interested, "no thanks" means "no more questions", not a change of mind.
        if "not_interested" in intents and self.call.get("outcome") == "interested" and \
                not re.search(r"\b(not interested|not looking|already|i'?ll pass|not for me|changed my mind)\b", text.lower()):
            name = self.call["applicant"].get("first_name") or ""
            return f"Thank you for your time, {name}. Goodbye.".replace(" .", "."), True, "response"
        if "not_interested" in intents:
            self.call["outcome"] = "not_interested"
            return "No problem, thank you for your time. We'll keep you in mind for other roles. Goodbye.", True, "decision"
        if "hold" in intents and not question:
            st["silence"] = -1  # one extra quiet turn while they're away
            return "Of course, take your time. I'm still here.", False, "response"
        if "repeat" in intents:
            return st.get("last_said") or self.opening(), False, "response"
        if "hello" in intents and len(intents) == 1:
            return "Yes, I'm here. " + follow, False, "response"

        # Guard rail: nothing outside the job and the company.
        if self._off_topic(text):
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
        if _words(text) & on_topic_words(self.job, self.company):
            said = "That's a good question. I'll ask our recruiter to answer that when they contact you. " + follow
            return self._finish(said, follow, "unanswered")
        if question or len(_words(text)) > 3:
            return self._finish(self._refuse(follow), follow, "off_topic")
        return self._finish("Sorry, I didn't quite get that. " + follow, follow, "response")

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
    await update_call(call_id, status="dialing", attempts=call["attempts"] + 1, dial_requested=False, error=None,
                      last_attempt_at=_now())
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
    due = [c for c in calls if c["status"] == "queued" and _due(c, now) and (c.get("dial_requested") or auto_ok)]
    due.sort(key=lambda c: (not c.get("dial_requested"), c.get("created_at", "")))
    for c in due[:room]:
        await dial(c["id"])


async def dialer_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
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
    if status in ("no_answer", "busy") and call["attempts"] < int(settings.get("max_attempts") or 1):
        changes["status"] = "queued"
        changes["next_attempt_at"] = (datetime.now(timezone.utc) + timedelta(minutes=int(settings.get("retry_minutes") or 60))).isoformat()
        changes["last_result"] = status
    if status == "completed" and not call.get("outcome"):
        changes["outcome"] = "no_response" if not call.get("transcript") else "unknown"
    call = await update_call(call_id, **changes)
    if call and call["status"] in _FINAL:
        await send_result(call)


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
            r = await client.post(url, json=payload)
        await update_call(call["id"], result_sent=r.status_code < 300)
    except Exception as e:
        logger.warning(f"Could not send call result to CRM: {e}")
        await update_call(call["id"], result_sent=False)
