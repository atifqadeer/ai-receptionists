"""
Settings > GuardRails > Call Rules: the agency's rules for when a number may
be called (again). Enforced on every way of placing a call: the auto dialer,
"Call" / "Call all" on Job Calls, and the dial pad.

  hang-up        the person put the phone down: wait `hangup_wait_minutes`
  callback       they asked to be called back: the job call is queued for the
                 time they said ("in 2 hours", "tomorrow morning", "at 3pm"),
                 or `callback_default_minutes` later; at most `callback_max`
                 times, and only within calling hours
  not interested no calls to that number about other jobs for
                 `not_interested_days` days
  wrong number   the number goes on the Do Not Call list
  voicemail      try again after `voicemail_retry_minutes`
  daily limit    at most `max_calls_per_day` calls to one number per day
  called before  a contact (and job) the agent has called is not queued again
                 when your portal or a CSV sends it again: never, or only after
                 `recall_after_days` days (kept even if the row is removed)

Calling hours/days, attempts for unanswered calls and the Do Not Call list
stay where they are (Calling > Outbound Calling, the Do Not Call page) and
apply on top of these.

MySQL documents: "call_rules" (the settings), "number_holds" (numbers that
must wait, and until when), "number_calls" (when each number was called,
for the daily limit).
"""

import re
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from loguru import logger

from app.core import store
from app.services import dnc

DEFAULTS = {
    "hangup_wait_minutes": 30,
    "callback_enabled": True,
    "callback_default_minutes": 120,
    "callback_max": 2,
    "not_interested_days": 30,
    "wrong_number_to_dnc": True,
    "voicemail_retry_minutes": 120,
    "max_calls_per_day": 3,
    "recall_after_days": 0,          # 0 = never call the same contact + job again
}
LIMITS = {   # field -> (min, max)
    "hangup_wait_minutes": (0, 1440),
    "callback_default_minutes": (5, 10080),
    "callback_max": (0, 5),
    "not_interested_days": (0, 365),
    "voicemail_retry_minutes": (5, 10080),
    "max_calls_per_day": (0, 20),
    "recall_after_days": (0, 365),
}

_DOC, _HOLDS, _CALLS, _CALLED = "call_rules", "number_holds", "number_calls", "contacts_called"
_lock = threading.Lock()


# ---- settings ----

def get() -> dict:
    return {**DEFAULTS, **(store.get_doc(_DOC) or {})}


def save(changes: dict) -> dict:
    s = get()
    for k, (lo, hi) in LIMITS.items():
        if k in changes:
            s[k] = max(lo, min(hi, int(changes[k])))
    for k in ("callback_enabled", "wrong_number_to_dnc"):
        if k in changes:
            s[k] = bool(changes[k])
    store.put_doc(_DOC, s)
    return s


def _tz() -> ZoneInfo:
    from app.services import telephony
    try:
        return ZoneInfo(telephony.load_settings().get("timezone") or "Europe/London")
    except Exception:
        return ZoneInfo("Europe/London")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _at(t: datetime) -> str:
    """'14:05' today, otherwise 'Tue 21 Nov 09:00' (in the calling time zone)."""
    local = t.astimezone(_tz())
    today = _now().astimezone(_tz()).date()
    return local.strftime("%H:%M") if local.date() == today else local.strftime("%a %d %b %H:%M")


# ---- holds: a number that must not be called until a given time ----

def _holds() -> dict:
    now = _now()
    numbers = (store.get_doc(_HOLDS) or {}).get("numbers", {})
    return {k: h for k, h in numbers.items() if datetime.fromisoformat(h["until"]) > now}


def hold(number: str, minutes: float, reason: str, call_id: str = "") -> None:
    k = dnc.key(number)
    if not k or number == "unknown" or minutes <= 0:
        return
    until = _now() + timedelta(minutes=minutes)
    with _lock:
        holds = _holds()
        old = holds.get(k)
        if old and datetime.fromisoformat(old["until"]) > until:
            return                          # a longer hold is already in place
        holds[k] = {"number": number, "reason": reason, "call_id": call_id,
                    "since": _now().isoformat(), "until": until.isoformat()}
        store.put_doc(_HOLDS, {"numbers": holds})
    logger.info(f"Call rules: {number} on hold until {_at(until)} ({reason})")


def holds() -> list:
    return sorted(_holds().values(), key=lambda h: h["until"])


def release(number: str) -> bool:
    k = dnc.key(number)
    with _lock:
        holds = _holds()
        if k not in holds:
            return False
        holds.pop(k)
        store.put_doc(_HOLDS, {"numbers": holds})
    return True


# ---- the daily limit ----

def note_call(number: str) -> None:
    """A call to `number` is being placed (counts towards the daily limit)."""
    k = dnc.key(number)
    if not k:
        return
    cutoff = (_now() - timedelta(days=2)).isoformat()
    with _lock:
        doc = (store.get_doc(_CALLS) or {}).get("numbers", {})
        doc = {n: [t for t in ts if t > cutoff] for n, ts in doc.items()}
        doc = {n: ts for n, ts in doc.items() if ts}
        doc.setdefault(k, []).append(_now().isoformat())
        store.put_doc(_CALLS, {"numbers": doc})


def _calls_today(number: str) -> int:
    tz = _tz()
    today = _now().astimezone(tz).date()
    ts = (store.get_doc(_CALLS) or {}).get("numbers", {}).get(dnc.key(number), [])
    return sum(1 for t in ts if datetime.fromisoformat(t).astimezone(tz).date() == today)


# ---- contacts the agent has called (who + which job) ----

def contact_keys(contact: dict, job: dict, phone: str) -> list:
    """How a contact + job is recognised: by your portal's ids, and by
    phone + job title (so it matches whether or not the ids came through)."""
    keys = []
    if contact.get("applicant_id"):
        keys.append(f"id:{contact['applicant_id']}|{job.get('job_id', '')}")
    if phone:
        keys.append(f"tel:{dnc.key(phone)}|{(job.get('job_title') or '').strip().lower()}")
    return keys


def note_contacted(keys: list, number: str) -> None:
    """The agent is calling this contact about this job."""
    if not keys:
        return
    with _lock:
        doc = (store.get_doc(_CALLED) or {}).get("contacts", {})
        for k in keys:
            doc[k] = {"at": _now().isoformat(), "number": number}
        store.put_doc(_CALLED, {"contacts": doc})


def called_before(keys: list) -> Optional[str]:
    """When this contact + job was last called, if that still blocks a new
    call (recall_after_days; 0 = always blocks)."""
    doc = (store.get_doc(_CALLED) or {}).get("contacts", {})
    # With your portal's ids, match on applicant + job only: two applicants
    # sharing a phone (a family, a test extension) are different contacts.
    # Phone + job title is the fallback for contacts sent without ids.
    by_id = [k for k in keys if k.startswith("id:")]
    hits = [doc[k]["at"] for k in (by_id or keys) if k in doc]
    if not hits:
        return None
    last = max(hits)
    days = get()["recall_after_days"]
    if days and datetime.fromisoformat(last) < _now() - timedelta(days=days):
        return None
    return last


def contacted_count() -> int:
    return len({v["number"] + v["at"][:16] for v in ((store.get_doc(_CALLED) or {}).get("contacts", {})).values()})


# ---- the check every call goes through ----

def check(number: str) -> Optional[tuple]:
    """(until, why) when `number` may not be called now, else None."""
    h = _holds().get(dnc.key(number))
    if h:
        until = datetime.fromisoformat(h["until"])
        return until, f"{number} {h['reason']}, so they are not called again until {_at(until)}."
    cap = get()["max_calls_per_day"]
    if cap and _calls_today(number) >= cap:
        tz = _tz()
        tomorrow = (_now().astimezone(tz) + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return tomorrow.astimezone(timezone.utc), (
            f"{number} has already been called {cap} time{'s' if cap != 1 else ''} today (the daily limit), "
            f"so they are not called again until tomorrow.")
    return None


def after_call(number: str, result: str, call_id: str = "", name: str = "", said: str = "",
               source: str = "job call", job: str = "") -> None:
    """Apply the rules for how a call ended (status or outcome)."""
    s = get()
    try:
        if result == "hung_up":
            hold(number, s["hangup_wait_minutes"], "hung up on the agent", call_id)
        elif result in ("not_interested",):
            hold(number, s["not_interested_days"] * 1440, "said they are not interested", call_id)
            from app.services import not_interested
            not_interested.add(number, source, said, call_id, name, job)
        elif result == "wrong_number" and s["wrong_number_to_dnc"]:
            dnc.add(number, "wrong number", said, call_id, name)
    except Exception as e:
        logger.warning(f"Call rules: could not apply '{result}' for {number}: {e}")


# ---- callbacks ----

_PART = {"morning": 10, "afternoon": 14, "evening": 18}
_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
                 "nine": 9, "ten": 10, "eleven": 11, "twelve": 12}


def callback_at(when: str, default_minutes: Optional[int] = None, now: Optional[datetime] = None) -> datetime:
    """When to call back (or meet), from what they said: "in 2 hours",
    "tomorrow morning", "at 3pm", "Thursday at 2pm", "tomorrow at 3",
    "next week", "on Monday"; `default_minutes` from now when no time was
    given. A day and a time are combined. Returned in UTC."""
    tz = _tz()
    now = (now or _now()).astimezone(tz)
    w = (when or "").lower().strip()
    # Speech-to-text writes "two pm", "half past three": as figures.
    for word, n in _NUMBER_WORDS.items():
        w = re.sub(rf"\b{word}\b", str(n), w)
    w = re.sub(r"\bhalf past (\d{1,2})\b", r"\1:30", w)
    default = timedelta(minutes=default_minutes if default_minutes is not None else get()["callback_default_minutes"])

    m = re.search(r"in (a|an|\d+|half an) (hour|hours|minute|minutes|bit)", w)
    if m:
        n, unit = m.group(1), m.group(2)
        if n == "half an" or unit == "bit":
            mins = 30
        else:
            k = 1 if n in ("a", "an") else int(n)
            mins = k * 60 if unit.startswith("hour") else k
        return (now + timedelta(minutes=mins)).astimezone(timezone.utc)

    # The day.
    day: Optional[datetime] = None
    if "tomorrow" in w:
        day = now + timedelta(days=1)
    elif "next week" in w:
        day = now + timedelta(days=7 - now.weekday())
    elif "next month" in w:
        day = now + timedelta(days=28)
    elif any(d in w for d in _DAYS):
        wd = next(i for i, d in enumerate(_DAYS) if d in w)
        day = now + timedelta(days=(wd - now.weekday()) % 7 or 7)
    elif "today" in w or "tonight" in w:
        day = now

    # The time of day.
    hour: Optional[int] = None
    minute = 0
    m = re.search(r"\b(?:(at|after|around|about|by) )?(\d{1,2})(?:[:.](\d\d))? ?(am|pm|a\.m\.|p\.m\.|o'?clock)?\b", w)
    if m and (m.group(1) or m.group(3) or m.group(4)) and int(m.group(2)) <= 23:
        hour, minute = int(m.group(2)), int(m.group(3) or 0)
        ampm = (m.group(4) or "").replace(".", "")
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        elif not ampm.endswith("m") and hour < 8:
            hour += 12                       # "at 3" during the working day means 3pm
    elif re.search(r"\b(noon|midday|lunch ?time)\b", w):
        hour = 12
    elif "tonight" in w or "evening" in w:
        hour = 18
    elif "afternoon" in w:
        hour = 14
    elif "morning" in w:
        hour = 10

    if day is None and hour is None:
        return (now + default).astimezone(timezone.utc)
    if day is None:
        day = now
    t = day.replace(hour=10 if hour is None else hour, minute=minute if hour is not None else 0,
                    second=0, microsecond=0)
    if t <= now:
        t += timedelta(days=1)               # "at 9" said at 10:00: tomorrow at 9
    return t.astimezone(timezone.utc)
