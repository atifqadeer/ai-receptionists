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
from app.services import call_intents, dnc, follow_ups, language_settings
from app.services import chat_language
from app.services import role_categories

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
# "Branch" the job's location; "Name" is split into first and
# last name when read; "ID" is the applicant's id in your CRM.
TEMPLATE = [
    ("ID", "applicant_id"), ("Name", "name"), ("Phone", "phone"), ("Email", "email"),
    ("Job Title", "job_title"), ("Office", "employer"), ("Branch", "location"),
    ("Salary", "salary"), ("Benefits", "benefits"), ("Qualifications", "qualifications"),
    ("Experience", "experience"), ("Job Type", "job_type"), ("Working Hours", "working_hours"),
    ("Job Description", "job_description"),
]
TEMPLATE_EXAMPLE = [
    "12345", "Sarah Jones", "07700 900123", "sarah@example.com",
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
    "applicant_id": ["candidate_id", "contact_id", "lead_id", "id"],
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
    "job_description": ["description", "jobdescription", "duties", "responsibilities", "summary", "job_summary"],
    "start_date": ["start", "startdate", "available_from", "availablefrom"],
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


def _who(rec: dict) -> dict:
    """What identifies a contact in a refresh summary."""
    return {"applicant_id": rec.get("applicant_id") or None, "job_id": rec.get("job_id") or None,
            "job_title": rec.get("job_title") or None, "phone": str(rec.get("phone") or "").strip() or None}


async def add_records(records: list, source: str) -> dict:
    """Queue a call per record. Records without a valid phone number or a
    job title are rejected; a record already queued (same applicant and
    job, or same phone and job title) is skipped."""
    settings = telephony.load_settings()
    added, skipped, rejected = [], [], []
    batch = f"{source}|{_now()}"
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
            called = call_rules.called_before(call_rules.contact_keys(rec, rec, phone))
            if called:
                skipped.append({"row": i, "reason": "already called", "at": called,
                                "name": f"{rec.get('first_name', '')} {rec.get('last_name', '')}".strip(),
                                **_who(rec)})
                continue
            def same(c: dict) -> bool:
                # Both with your portal's ids: compare those only, so two
                # applicants sharing a phone are not taken for one.
                if rec.get("applicant_id") and c["applicant"].get("applicant_id"):
                    return (str(c["applicant"]["applicant_id"]) == str(rec["applicant_id"])
                            and str(c["job"].get("job_id") or "") == str(rec.get("job_id") or ""))
                return c["applicant"]["phone"] == phone and c["job"].get("job_title", "").lower() == rec["job_title"].lower()
            dup = next((c for c in calls if c["status"] not in _FINAL and same(c)), None)
            if dup:
                skipped.append({"row": i, "id": dup["id"], "reason": "already queued",
                                "name": f"{rec.get('first_name', '')} {rec.get('last_name', '')}".strip(), **_who(rec)})
                continue
            call = {
                "id": uuid.uuid4().hex,
                "source": source,
                "batch": batch,
                "applicant": {k: rec.get(k, "") for k in ("applicant_id", "first_name", "last_name", "email", "notes")}
                | {"phone": phone, "phone_original": str(rec.get("phone", "")).strip()},
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
    """Both CRM APIs: the last fetch, and the status updates sent back."""
    st = _crm_state()
    calls = _load()
    sent = [c for c in calls if c.get("result_sent") is True]
    unsent = [c for c in calls if c.get("result_sent") is False]
    return {
        "last": st.get("last"),
        "imported_total": sum(1 for c in calls if c.get("source") == "crm"),
        "results": {
            "url": (telephony.load_settings().get("result_webhook_url") or "").strip(),
            "sent": len(sent),
            "unsent": len(unsent),
            "last": (store.get_doc("crm_results") or {}).get("last"),
        },
    }


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


def _crm_error(r) -> str:
    """The portal's own reason for refusing, in one line."""
    try:
        body = r.json()
        msg = body.get("message") or ""
        errors = body.get("errors") or {}
        if isinstance(errors, dict) and errors:
            msg = "; ".join(str(v[0] if isinstance(v, list) and v else v) for v in errors.values())
        if msg:
            return msg[:300]
    except Exception:
        pass
    return (r.text or "")[:200]


def _next_page(body, page: int) -> Optional[int]:
    """The next page number when the portal says there is more
    (meta.has_more, or meta/top-level last_page > page)."""
    if not isinstance(body, dict):
        return None
    meta = body.get("meta") if isinstance(body.get("meta"), dict) else body
    if meta.get("has_more") is True:
        return page + 1
    last = meta.get("last_page")
    if isinstance(last, int) and page < last:
        return page + 1
    return None


async def _fetch_pages(url: str, headers: dict, max_pages: int = 20) -> list:
    """GET the applicants, following the portal's pages (?page=2, ...)."""
    items, page = [], 1
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            while True:
                params = {"page": page} if page > 1 else None
                r = await client.get(url, headers=headers, params=params)
                if r.status_code in (401, 403):
                    raise ValueError(f"The portal refused the API key ({r.status_code}): {_crm_error(r)}")
                if r.status_code >= 400:
                    raise ValueError(f"The portal answered {r.status_code}: {_crm_error(r)}")
                try:
                    body = r.json()
                except json.JSONDecodeError as e:
                    raise ValueError("The portal did not return JSON.") from e
                items += _crm_items(body)
                nxt = _next_page(body, page)
                if not nxt or nxt > max_pages:
                    return items
                page = nxt
    except httpx.HTTPError as e:
        raise ValueError(f"Could not reach the portal at {url}: {e}") from e


def _crm_ident(applicant: dict, job: dict, phone: str) -> str:
    """Who + which job: applicant id + job id, or phone + job title."""
    if applicant.get("applicant_id"):
        return f"{applicant.get('applicant_id')}|{job.get('job_id', '')}"
    return f"{phone}|{(job.get('job_title') or '').lower()}"


async def _fill_missing_ids(items: list, cc: str) -> int:
    """Job calls saved without the CRM's contact / job id (or the phone as
    the CRM writes it, or the email) get them from a fetch with the same
    phone and job title: they are needed to send the call status back."""
    found = {}
    for raw in items:
        if isinstance(raw, dict):
            rec = normalize_record(raw)
            phone = telephony.normalize_phone(rec.get("phone", ""), cc)
            if phone and rec.get("applicant_id"):
                found[(phone, (rec.get("job_title") or "").lower())] = rec
    if not found:
        return 0
    filled = 0
    async with _lock:
        calls = _load()
        for c in calls:
            rec = found.get((c["applicant"].get("phone"), (c["job"].get("job_title") or "").lower()))
            if not rec:
                continue
            changed = False
            if not c["applicant"].get("applicant_id"):
                c["applicant"]["applicant_id"] = rec["applicant_id"]
                changed = True
            if rec.get("job_id") and not c["job"].get("job_id"):
                c["job"]["job_id"] = rec["job_id"]
                changed = True
            if not c["applicant"].get("phone_original") and rec.get("phone"):
                c["applicant"]["phone_original"] = str(rec["phone"]).strip()   # as the portal writes it
                changed = True
            if not c["applicant"].get("email") and rec.get("email"):
                c["applicant"]["email"] = rec["email"]
                changed = True
            filled += changed
        if filled:
            _save(calls)
    if filled:
        logger.info(f"CRM pull: filled in the CRM id of {filled} job call(s)")
    return filled


async def pull_from_crm() -> dict:
    """Fetch applicants from the CRM API and queue a call for each one not
    already on Job Calls (matched by applicant + job id, or phone + job
    title). Applicants removed from Job Calls are queued again."""
    settings = telephony.load_settings()
    url = (settings.get("crm_api_url") or "").strip()
    if not url:
        raise ValueError("Set the Fetch API URL first (Settings > Webhooks).")
    headers = {"Accept": "application/json"}
    key = (settings.get("crm_api_key") or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
        headers["X-API-Key"] = key
    async with _crm_lock:
        started = _now()
        try:
            items = await _fetch_pages(url, headers)
        except ValueError as e:
            # Kept, so the Webhooks tab shows why the last refresh failed.
            st = _crm_state()
            st["last"] = {"at": started, "url": url, "error": str(e)}
            store.put_doc("crm_import", st)
            raise

        # Skip applicants already on Job Calls (any status, so a finished
        # call is not queued again). Removed ones are fetched again.
        cc = settings.get("default_country_code") or ""
        seen = {_crm_ident(c["applicant"], c["job"], c["applicant"].get("phone", "")) for c in _load()}
        records, already, here = [], 0, []
        for raw in items:
            if not isinstance(raw, dict):
                continue
            rec = normalize_record(raw)
            if not rec.get("applicant_id") and raw.get("id") not in (None, ""):
                rec["applicant_id"] = str(raw["id"])
            ident = _crm_ident(rec, rec, telephony.normalize_phone(rec.get("phone", ""), cc) or rec.get("phone", ""))
            if ident in seen:
                already += 1
                here.append({"reason": "already here", **_who(rec),
                             "name": f"{rec.get('first_name', '')} {rec.get('last_name', '')}".strip()})
                continue
            seen.add(ident)                 # the same applicant twice in one response
            records.append(rec)
        result = await add_records(records, source="crm") if records else {"added": 0, "skipped": [], "rejected": [], "ids": []}
        await _fill_missing_ids(items, cc)
        called = sum(1 for x in result["skipped"] if x.get("reason") == "already called")
        summary = {"at": started, "url": url, "fetched": len(items), "added": result["added"], "ids": result.get("ids", []),
                   "already_imported": already + len(result["skipped"]) - called, "already_called": called,
                   "rejected": result["rejected"],
                   # Who was not queued, so the page can list them.
                   "skipped": here + [{**x, "reason": "already here" if x["reason"] == "already queued" else x["reason"]}
                                      for x in result["skipped"]]}
        st = _crm_state()
        st.pop("imported", None)            # the old "ever imported" memory is no longer used
        st["last"] = summary
        store.put_doc("crm_import", st)
    logger.info(f"CRM pull: {len(items)} fetched, {result['added']} queued, {summary['already_imported']} already on Job Calls, "
                f"{called} already called, "
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


LIVE_STATUSES = ("dialing", "ringing", "in_progress")
STALE_AFTER = 30           # seconds a SIP call may be "live" without its call thread (it is starting)


def _sip_thread_alive(call_id: str) -> bool:
    import threading
    name = f"sip-call-{call_id[:8]}"
    return any(t.name == name and t.is_alive() for t in threading.enumerate())


def _orphaned(c: dict, now: datetime) -> bool:
    """A SIP job call marked live whose call no longer exists in this
    backend: it was cut off by a restart (the backend reloads when its
    code changes) or the call thread crashed. Left as is, it counts as a
    call in progress forever and the dialer places no more calls."""
    if c.get("status") not in LIVE_STATUSES or not str(c.get("provider_call_id") or "sip-").startswith("sip-"):
        return False
    try:
        changed = datetime.fromisoformat(c.get("updated_at") or c.get("last_attempt_at") or "")
    except ValueError:
        changed = now - timedelta(seconds=STALE_AFTER + 1)
    return (now - changed).total_seconds() > STALE_AFTER and not _sip_thread_alive(c["id"])


async def recover_orphaned_calls() -> int:
    """Close job calls left "in progress" with no call behind them. A call
    that never got answered goes back in the queue; one that was answered
    ends as dropped (it is reported to the CRM like any other call)."""
    now = datetime.now(timezone.utc)
    fixed = []
    async with _lock:
        calls = _load()
        for c in calls:
            if not _orphaned(c, now):
                continue
            if c["status"] == "in_progress" or c.get("answered_at"):
                c.update(status="dropped", ended_at=c.get("ended_at") or _now(), updated_at=_now(),
                         error="The call was cut off: the backend restarted (or the call stopped) mid-call.")
                fixed.append((c["id"], True))
            else:
                c.update(status="queued", updated_at=_now(), next_attempt_at=None,
                         error="The backend restarted while dialling; the call will be placed again.")
                fixed.append((c["id"], False))
        if fixed:
            _save(calls)
    for call_id, ended in fixed:
        logger.warning(f"Outbound call {call_id}: no live call behind it; "
                       + ("marked as dropped" if ended else "put back in the queue"))
        if ended:
            call = get_call(call_id)
            if call:
                await send_result(call, "dropped")
    return len(fixed)


async def delete_calls(call_ids: list) -> dict:
    """Remove several applicants / job calls at once. Calls in progress are
    kept (hang up first)."""
    wanted = {str(i) for i in call_ids or []}
    async with _lock:
        calls = _load()
        live = [c["id"] for c in calls if c["id"] in wanted and c.get("status") in LIVE_STATUSES]
        kept = [c for c in calls if c["id"] not in wanted or c["id"] in live]
        removed = len(calls) - len(kept)
        if removed:
            _save(kept)
    logger.info(f"Outbound: {removed} job call(s) removed, {len(live)} kept (in progress)")
    return {"removed": removed, "kept_in_progress": len(live)}


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

def _join(items: list) -> str:
    """"Nurse", "Care Assistant" -> "Nurse and Care Assistant"."""
    items = [_clean(x) for x in items if x]
    return ", ".join(items[:-1]) + " and " + items[-1] if len(items) > 1 else (items[0] if items else "")


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
    # "No, everything is clear" / "no I'm good" after "anything else you'd like to know?"
    ("all_clear", r"\b(everything('?s| is)? (clear|fine|good|ok(ay)?)|all (clear|good|fine)|that'?s (clear|fine|everything)|"
                  r"(no|not any|don'?t have any) (other |more |further )?questions?|nothing (else|more)( for now)?|"
                  r"i'?m (good|fine|ok(ay)?|all good)|no,? (it'?s|that'?s) (fine|ok(ay)?|alright|good)|got it)\b"),
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
        # The job's category, the company's other roles in it, and the roles
        # outside it (never offered or described on this call).
        all_roles = (knowledge.roles() if knowledge else []) + role_categories.split_roles(self.profile.get("services") or "")
        self.category, self.related_roles, self.other_roles = role_categories.same_category(self.job, all_roles)
        self.category = self.category or "this field"
        self.state = call.setdefault("state", {})
        self.agent_name = agent_name
        self.company = company
        self.knowledge = knowledge
        self.contact = contact

    def opening(self) -> str:
        return opening_pitch(self.call, self.agent_name, self.company)

    # ---- the Deepgram card: the same call, held by the Deepgram Voice Agent's LLM ----

    _JOB_FIELDS = (("job_title", "Job title"), ("employer", "Employer"), ("location", "Location"),
                   ("salary", "Salary"), ("benefits", "Benefits"), ("working_hours", "Working hours"),
                   ("job_type", "Job type"), ("start_date", "Start date"), ("qualifications", "Qualifications"),
                   ("experience", "Experience"), ("job_description", "Duties"))

    def voice_agent_prompt(self) -> str:
        """The instructions for the LLM when Deepgram holds the whole call
        (deepgram_agent): the job, the company and the same limits as the
        rule-based conversation (only this job's field, facts only from here)."""
        name = (self.call.get("applicant") or {}).get("first_name") or "the applicant"
        title = _clean(self.job.get("job_title") or "")
        job = "\n".join(f"- {label}: {_clean(str(self.job[k]))}" for k, label in self._JOB_FIELDS if self.job.get(k))
        about = self._role_safe(self.knowledge.overview() if self.knowledge else None) or ""
        p = self.profile
        company = "\n".join(f"- {label}: {_clean(str(p[k]))}" for k, label in
                            (("address", "Office address"), ("phone", "Phone"), ("email", "Email"),
                             ("business_hours", "Office hours")) if p.get(k))
        related = (f"Other roles {self.company} recruits for in {self.category}: {_join(self.related_roles)}. "
                   "Mention them only if asked; a recruiter gives the details.") if self.related_roles else ""
        return f"""You are {self.agent_name}, an AI recruitment assistant calling from {self.company}.
You are phoning {name} about a {title} position. You have already opened the call with:
"{self.opening()}"
Listen to their answer and carry on from there.

THE JOB:
{job}

THE COMPANY:
{about or f"{self.company} is a recruitment agency."}
{company}
{related}

YOUR GOAL: find out whether {name} is interested in this {title} position and answer their questions about it.
- Interested: say a recruiter will be in touch with the next steps, ask if they have any other questions,
  then end the call with outcome interested.
- Not interested, already has a job, or a plain no: thank them politely and end the call (not_interested).
- Busy or asks to be called later: ask when suits them, then end the call (callback, with when).
- Asks not to be called again: apologise, confirm, end the call (do_not_call).
- Wrong person or never applied: apologise, end the call (wrong_number).
- An answering machine or voicemail greeting: say who you are and that you'll try again later, then end (voicemail).

RULES:
- Job facts come ONLY from THE JOB above. Anything not listed: say the recruiter will confirm it.
- Talk only about this job{" and the roles in " + self.category if self.related_roles else ""}; never offer other kinds of work.
- If asked, say honestly that you are an AI assistant. Their details are registered with {self.company}.
- This is a short call: keep every answer to one or two sentences.
"""

    def _record_meeting(self, when: str, said: str) -> None:
        """A meeting request on a job call: on the Follow-ups page for the team."""
        a = self.call.get("applicant") or {}
        follow_ups.add("meeting", "job call", phone=a.get("phone", ""), email=a.get("email", "") or "",
                       name=" ".join(x for x in (a.get("first_name"), a.get("last_name")) if x),
                       when=when, said=said, ref=self.call.get("id", ""),
                       job=_clean(self.job.get("job_title") or ""))
        self.call["meeting_requested"] = when or "no time given"

    def voice_agent_lookup(self, question: str) -> str:
        """The knowledge base search for the Voice Agent's lookup_company_info."""
        intent = company_facts.detect(question, self.company)
        if intent:
            fact = self._job_answer("company_about" if intent == "company_services" else intent)
            if fact:
                return fact
        if not self.knowledge:
            return ""
        faq = self.knowledge.faq_answer(question)
        if faq:
            return faq
        answer, _ = self.knowledge.search_detail(question, self.job.get("job_title"))
        return self._role_safe(answer) or ""

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
        if intent == "company_about":
            # The company introduction, unless it lists roles outside this job's field.
            about = self._role_safe(self.knowledge.overview() if self.knowledge else None)
            title = _clean(j["job_title"])
            return about or (f"{self.company} is a recruitment agency that places candidates with employers"
                             + (f" in {self.category}" if self.related_roles or self.category != "this field" else "")
                             + f". Today I'm calling about the {title} position.")
        if intent == "roles":
            # Only roles in this job's own category ("care and health" for a
            # Registered Manager call): the call never moves to other kinds of work.
            title = _clean(j["job_title"])
            if self.related_roles:
                listed = _join(self.related_roles)
                return (f"In {self.category}, besides this {title} position, we also recruit for {listed}. "
                        f"Our recruiter can tell you more about those; today I'm calling about the {title} role.")
            return (f"Today I'm calling about the {title} position, and that's the role I can tell you about. "
                    f"Our recruiter can let you know about any other suitable vacancies.")
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
            return f"Your details are registered with {self.company}, which is why we're calling about this role."
        return None

    def reply(self, text: str, interrupted: bool = False) -> tuple:
        """(what the agent says, end the call?) for the applicant's words.
        Sets call["outcome"] when the applicant decides, and keeps a note
        of every applicant response (question, answer, decision) in
        call["notes"]. `interrupted`: the applicant spoke over the agent."""
        text = (text or "").strip()
        meet = follow_ups.meeting_reply(self.state, text, self._record_meeting) if text else None
        if meet:
            # Asking for a meeting about the job means they're interested.
            if not self.call.get("outcome"):
                self.call["outcome"] = "interested"
            if not meet.endswith("?"):
                meet += " Is there anything else you'd like to know about the role?"
            said, end, kind = meet, False, "meeting"
        else:
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
        situation = (f"You are on a phone call with {self.call['applicant'].get('first_name') or 'a contact'}, "
                     f"telling them about a {_clean(j.get('job_title'))} position"
                     + (f" in {_clean(j['location'])}" if j.get("location") else "")
                     + ". Job details: " + "; ".join(f"{k.replace('_', ' ')}: {_clean(v)}" for k, v in j.items() if v) + ".")
        title = _clean(j.get("job_title")) or "this"
        situation += (f" STAY ON THIS ROLE: talk only about the {title} position"
                      + (f" and, if asked, other {self.category} roles ({_join(self.related_roles)})" if self.related_roles else "")
                      + ". Never describe, suggest or offer roles outside this field"
                      + (f" (such as {_join(self.other_roles[:4])})" if self.other_roles else "")
                      + "; if the person asks about them, say the recruiter can discuss other kinds of roles separately.")
        history = []
        for n in (self.call.get("notes") or [])[-3:]:
            history += [{"role": "user", "content": n.get("applicant", "")}, {"role": "assistant", "content": n.get("agent", "")}]
        return self._role_safe(self.think(text, situation, history))

    def _role_safe(self, answer: Optional[str]) -> Optional[str]:
        """`answer`, unless it talks about roles outside this job's category
        (a knowledge passage from the Chef document on a nurse call)."""
        if answer and role_categories.mentions(answer, self.other_roles):
            return None
        return answer

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
        if re.search(r"\babout (your|the|this) (company|agency|business|firm|organi[sz]ation)\b|\bwhat (does|do) "
                     r"(your|the) (company|agency) do\b", text, re.I) or "company_services" in intents:
            intents = ["company_about"]
        # "Where is Kingsbury Personnel?": the office, not the job's location.
        elif company_facts.detect(text, self.company) == "company_address":
            intents = ["company_address"]
        # "No, everything is clear. Hello?": a "hello?" / "are you there?" at the
        # end checks the line is still open; it doesn't make the rest a question.
        core = re.sub(r"[\s,.]*\b(hello|hi|are you (still )?there|you there)\W*$", "", text, flags=re.I).strip()
        question = is_question(core or text)
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
        if not question and ("goodbye" in intents or (decided and ("thanks" in intents or "all_clear" in intents)) or
                             (decided and re.fullmatch(r"\W*(no|nope|nah|no thanks?)\W*", text.lower()))):
            name = self.call["applicant"].get("first_name") or ""
            return f"Thank you for your time, {name}. Goodbye.".replace(" .", "."), True, "response"
        if "thanks" in intents and not question:
            return self._finish("You're welcome. " + follow, follow, "response")

        # Asked about a different kind of role (a chef job on a nurse call):
        # don't switch roles; the recruiter handles that.
        other = role_categories.mentions(text, self.other_roles)
        if other and not role_categories.mentions(text, self.related_roles + [self.job.get("job_title") or ""]):
            title = _clean(self.job.get("job_title")) or "this"
            return self._finish(f"On this call I can only help with the {title} position and other {self.category} "
                                f"roles. Our recruiter can talk to you about {other[0]} roles separately. " + follow,
                                follow, "off_topic")

        kb_answer = self._role_safe(self.knowledge.search(text, self.job.get("job_title")) if self.knowledge else None)
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
        # Not a call: nothing to report (the CRM already blocks do_not_call numbers).
        return await update_call(call_id, status="dnc", outcome="do_not_call", dial_requested=False,
                                 result_sent=None)
    blocked = call_rules.check(call["applicant"]["phone"])
    if blocked:                 # Call Rules: wait (hang-up, not interested, daily limit)
        until, why = blocked
        logger.info(f"Outbound call {call_id}: {why}")
        return await update_call(call_id, status="queued", next_attempt_at=until.isoformat(), held_reason=why)
    call_rules.note_call(call["applicant"]["phone"])
    call_rules.note_contacted(call_rules.contact_keys(call["applicant"], call["job"], call["applicant"]["phone"]),
                              call["applicant"]["phone"])
    await update_call(call_id, status="dialing", attempts=call["attempts"] + 1, dial_requested=False, error=None,
                      last_attempt_at=_now(), scheduled_callback=False, held_reason=None)
    try:
        provider_id = await telephony.place_call(settings, call["applicant"]["phone"], call_id)
        return await update_call(call_id, provider_call_id=provider_id)
    except Exception as e:
        logger.warning(f"Outbound call {call_id} failed to start: {e}")
        call = await update_call(call_id, status="failed", error=str(e), ended_at=_now())
        await send_result(call, "failed")
        return get_call(call_id)


async def dialer_pass() -> None:
    """Place the calls that are due: manual requests always; queued calls
    automatically when call mode is "auto" and it is within calling hours."""
    settings = telephony.load_settings()
    if not telephony.is_configured(settings):
        return
    await recover_orphaned_calls()      # a call cut off by a restart must not block the queue
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
            from app.services import follow_ups
            await follow_ups.dial_due()       # dial-pad callbacks and voicemails, dialled again
        except Exception as e:
            logger.error(f"Follow-up dialer error: {e}")
        try:
            await _maybe_resend_results()
        except Exception as e:
            logger.error(f"Result resend error: {e}")
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
    said = call.get("outcome_said") or next((n.get("applicant", "") for n in reversed(call.get("notes") or [])
                                             if n.get("kind") == "decision"), "")
    call_rules.after_call(phone, changes["status"], call_id, name, said, "job call",
                          _clean(call.get("job", {}).get("job_title") or ""))
    attempt_status = changes["status"]      # what happened on this call, before any re-queue
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
    if changes["status"] in ("callback", "queued") and (changes.get("last_result") == "callback"
                                                        or changes["status"] == "callback"):
        # Listed on the Follow-ups page too: re-queued here, or for the team
        # once Call Rules' callback limit is reached.
        from app.services import follow_ups
        queued = changes["status"] == "queued"
        try:
            await asyncio.to_thread(
                follow_ups.add, "callback", "job call", phone=phone, name=name, when=call.get("callback_when") or "",
                said=said, ref=call_id, job=_clean(call.get("job", {}).get("job_title") or ""),
                due_at=call_rules.callback_at(call.get("callback_when") or "") if queued else None,
                status="scheduled" if queued else "open",
                note="Re-queued on the Job Calls page." if queued else
                     "Not re-queued: Call Rules' callback limit reached or callbacks are off. Call by hand.")
        except Exception as e:
            logger.warning(f"Outbound call {call_id}: follow-up not recorded: {e}")
    if status == "completed" and not call.get("outcome"):
        changes["outcome"] = "no_response" if not call.get("transcript") else "unknown"
    call = await update_call(call_id, **changes)
    if call:
        # Every attempt is reported, including ones queued for a retry or a
        # callback: the CRM gets what happened on this call (the attempt's
        # status), plus whether we will call again.
        await send_result(call, attempt_status)


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


# The CRM's call-outcome API (POST /api/applicants/call-outcome) accepts
# call_status in CRM_CALL_STATUSES and, only when answered, an outcome in
# CRM_OUTCOMES (callback needs callback_at).
CRM_CALL_STATUSES = ("answered", "no_answer", "busy", "voicemail", "wrong_number", "failed")
CRM_OUTCOMES = ("interested", "not_interested", "callback", "not_looking", "do_not_call")
# Our outcomes the CRM has no word for: what they mean for the CRM.
_CRM_OUTCOME_FOR = {"abusive": "not_interested"}
# Answered, but the conversation never reached an answer: reported as a
# failed call so the CRM's re-call rules try again later.
_UNFINISHED = {"no_response", "undecided", "unknown", "end_call", None, ""}


def _crm_call_fields(call: dict, result_status: str) -> dict:
    """call_status / outcome / callback_at as the CRM's call-outcome API
    validates them, from what happened on this attempt."""
    outcome = call.get("outcome")
    outcome = _CRM_OUTCOME_FOR.get(outcome, outcome)
    callback_at = None
    if outcome == "voicemail":
        call_status, outcome = "voicemail", None
    elif outcome == "wrong_number" or result_status == "wrong_number":
        call_status, outcome = "wrong_number", None
    elif result_status in ("no_answer", "busy"):
        call_status, outcome = result_status, None
    elif outcome in CRM_OUTCOMES and call.get("answered_at"):
        call_status = "answered"
        if outcome == "callback":
            at = call.get("next_attempt_at") if call.get("scheduled_callback") else None
            callback_at = at or call_rules.callback_at(call.get("callback_when") or "").isoformat()
    else:
        # failed, dropped, hung up mid-call, or answered with no decision
        call_status, outcome = "failed", None
    return {"call_status": call_status, "outcome": outcome, "callback_at": callback_at}


def _transcript_text(call: dict) -> str:
    return "\n".join(f"{'Agent' if t.get('role') == 'agent' else 'Applicant'}: {t.get('text', '')}"
                     for t in call.get("transcript") or [])


def _int_id(v):
    return int(v) if isinstance(v, str) and v.strip().isdigit() else v


def _duration(call: dict) -> Optional[int]:
    try:
        start, end = call.get("answered_at"), call.get("ended_at")
        if start and end:
            return max(0, int((datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()))
    except ValueError:
        pass
    return None


async def send_result(call: dict, attempt_status: Optional[str] = None) -> bool:
    """Send a job call's result back to the CRM (Result API) after every
    attempt. `attempt_status` is what happened on this call (no_answer,
    callback, interested...) even when the call is queued again; it is kept
    on the call so a resend reports the same thing.
    Failures are kept (result_sent False) and retried by the dialer loop."""
    if not call:
        return False
    result_status = attempt_status or call.get("result_status") or call["status"]
    url = (telephony.load_settings().get("result_webhook_url") or "").strip()
    if url:
        # Marked as waiting to send *before* the request: if the send is cut
        # off (backend restart, crash), the dialer loop's resend still finds it.
        await update_call(call["id"], result_status=result_status, result_sent=False)
    elif attempt_status:
        await update_call(call["id"], result_status=result_status)
    if not url:
        return False
    a, j = call.get("applicant") or {}, call.get("job") or {}
    will_retry = call["status"] == "queued"
    summary = notes_summary(call)
    payload = {
        "event": "call.finished",
        "call_id": call["id"],
        "applicant_id": _int_id(a.get("applicant_id")),
        "contact_id": _int_id(a.get("applicant_id")),
        "contact_name": " ".join(x for x in (a.get("first_name"), a.get("last_name")) if x),
        "job_id": _int_id(j.get("job_id")),
        "job_title": j.get("job_title") or j.get("title"),
        # As your portal sent it (07… stays 07…), so it matches the record
        # instead of reading as a phone change.
        "phone": a.get("phone_original") or a.get("phone"),
        "email": a.get("email") or None,
        # The CRM call-outcome fields: call_status, outcome, callback_at.
        **_crm_call_fields(call, result_status),
        "called_at": call.get("answered_at") or call.get("last_attempt_at") or call.get("ended_at"),
        "duration_seconds": _duration(call),
        "summary": summary or None,
        "transcript": _transcript_text(call) or None,
        # Our own detail, for CRMs that want it.
        "status": result_status,                 # this attempt: interested, no_answer, callback, failed...
        "agent_outcome": call.get("outcome"),
        "queue_status": call["status"],          # where the call is now ("queued" = we will call again)
        "final": not will_retry,
        "will_retry": will_retry,
        "next_attempt_at": call.get("next_attempt_at") if will_retry else None,
        "attempts": call.get("attempts"),
        "callback_when": call.get("callback_when"),
        "transcript_lines": call.get("transcript", []),
        "notes": call.get("notes", []),
        "notes_summary": summary,
        "finished_at": call.get("ended_at"),
    }
    if payload["email"]:
        # The record is found by its id (and email); a phone the portal
        # stores differently would read as a phone change and be refused.
        payload.pop("phone")
    id_field = (telephony.load_settings().get("crm_id_field") or "").strip()
    if id_field and id_field not in payload:
        payload = {id_field: payload["contact_id"], **payload}     # what your portal calls the id
    tries = int(call.get("result_tries") or 0) + 1
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # The status API's own key, or (when blank) the key used to fetch contacts.
            st = telephony.load_settings()
            key = (st.get("crm_result_key") or "").strip() or (st.get("crm_api_key") or "").strip()
            headers = {"Authorization": f"Bearer {key}", "X-API-Key": key} if key else {}
            r = await client.post(url, json=payload, headers=headers)
        ok = r.status_code < 300
        error = None if ok else f"The portal answered {r.status_code}: {(r.text or '')[:400]}"
    except Exception as e:
        ok, error = False, f"Could not reach {url}: {e}"[:250]
    if not ok:
        logger.warning(f"Call result for {call['id'][:8]} not sent (try {tries}): {error}")
    await update_call(call["id"], result_sent=ok, result_tries=tries, result_error=error,
                      result_sent_at=_now() if ok else call.get("result_sent_at"))
    store.put_doc("crm_results", {"last": {"at": _now(), "call_id": call["id"], "ok": ok, "error": error,
                                           "status": result_status, "outcome": call.get("outcome"),
                                           "name": payload["contact_name"] or payload.get("phone") or payload.get("email")}})
    return ok


RESULT_MAX_TRIES = 6
_last_retry = {"at": 0.0}


async def resend_results(force: bool = False) -> dict:
    """Send again the call statuses the CRM did not accept. Automatic
    retries stop after RESULT_MAX_TRIES; `force` (the Resend button) tries all."""
    # result_sent False: refused or cut off. None with a result_status: a
    # send interrupted before this was marked (older records).
    pending = [c for c in _load() if (c.get("result_sent") is False
                                      or (c.get("result_sent") is None and c.get("result_status")))
               and (c.get("result_status") or c.get("status") in _FINAL)
               and (force or int(c.get("result_tries") or 0) < RESULT_MAX_TRIES)]
    sent = 0
    for c in pending:
        if await send_result(c):
            sent += 1
    return {"tried": len(pending), "sent": sent, "failed": len(pending) - sent}


async def _maybe_resend_results() -> None:
    """The dialer loop's retry of unsent statuses, every 5 minutes."""
    import time
    if time.time() - _last_retry["at"] < 300:
        return
    _last_retry["at"] = time.time()
    if (telephony.load_settings().get("result_webhook_url") or "").strip():
        await resend_results()
