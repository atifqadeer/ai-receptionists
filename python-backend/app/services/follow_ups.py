"""
Follow-ups: callback and meeting requests from every channel, in MySQL
(document "follow_ups"), shown on the Follow-ups page.

  callback  "call me back tomorrow morning" (chat, dial-pad and job calls)
            or an answering machine on a dial-pad call
  meeting   "can you schedule a meeting with the recruiter?",
            "I'd like to book an appointment for Thursday at 2pm"

Dial-pad callbacks and voicemails are dialled again automatically
(auto_dial) at the time asked for, within calling hours, at most Call
Rules' `callback_max` times in a row; job calls are re-queued on the Job
Calls page as before and are listed here for the record. Chat callbacks
and all meetings are for the team to action (status "open"): there is no
calendar to book into.

status: open (for the team) / scheduled (the agent will dial) / dialled /
done / failed / cancelled.
"""

import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from loguru import logger

from app.core import store

_DOC = "follow_ups"
_lock = threading.Lock()
KEEP = 1000
DIAL_RETRY_MINUTES = 30      # the dial couldn't be placed (line busy, blocked): try again after
DIAL_FAILURES_MAX = 3


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(t: Optional[datetime]) -> Optional[str]:
    return t.isoformat(timespec="seconds") if t else None


def _load() -> list:
    return list((store.get_doc(_DOC) or {}).get("items") or [])


def _save(items: list) -> None:
    store.put_doc(_DOC, {"items": items[:KEEP]})


def entries() -> list:
    """Newest first."""
    with _lock:
        return _load()


def add(kind: str, source: str, *, phone: str = "", name: str = "", email: str = "", when: str = "",
        said: str = "", ref: str = "", job: str = "", auto_dial: bool = False, round_no: int = 0,
        due_at: Optional[datetime] = None, note: str = "", status: str = "") -> dict:
    """Record a request. `when`: the time they asked for, as they said it;
    due_at is worked out from it (meetings without a time have none)."""
    from app.services import call_rules
    if due_at is None and (when or kind == "callback"):
        due_at = call_rules.callback_at(when)
    item = {"id": uuid.uuid4().hex[:12], "kind": kind, "source": source, "name": (name or "").strip()[:120],
            "phone": (phone or "").strip()[:40], "email": (email or "").strip()[:160], "when": (when or "")[:80],
            "due_at": _iso(due_at), "said": (said or "")[:400], "ref": ref, "job": (job or "")[:120],
            "auto_dial": bool(auto_dial), "round": round_no, "status": status or ("scheduled" if auto_dial else "open"),
            "note": note[:300], "created_at": _iso(_now()), "updated_at": _iso(_now()),
            "dial_failures": 0, "last_call_id": "", "result": ""}
    with _lock:
        items = _load()
        items.insert(0, item)
        _save(items)
    logger.info(f"Follow-up: {kind} from {source} ({item['name'] or item['phone'] or 'no contact'}, "
                f"{item['when'] or 'no time given'})")
    return item


def update(item_id: str, **changes) -> Optional[dict]:
    with _lock:
        items = _load()
        for it in items:
            if it["id"] == item_id:
                allowed = {k: v for k, v in changes.items() if k in it or k in ("result",)}
                if "due_at" in allowed and isinstance(allowed["due_at"], datetime):
                    allowed["due_at"] = _iso(allowed["due_at"])
                it.update(allowed, updated_at=_iso(_now()))
                _save(items)
                return it
    return None


def remove(item_id: str) -> bool:
    with _lock:
        items = _load()
        kept = [it for it in items if it["id"] != item_id]
        if len(kept) == len(items):
            return False
        _save(kept)
    return True


def _for_call(call_id: str) -> Optional[dict]:
    return next((it for it in _load() if call_id and it.get("last_call_id") == call_id), None)


# ---- meeting requests on calls ----

_QUESTION = ("what", "how", "where", "when", "who", "which", "why", "is ", "are ", "do ", "does ", "can ", "could ")


def meeting_reply(state: dict, text: str, record) -> Optional[str]:
    """One turn of a meeting request on a call. state: the call's own dict
    (it remembers a request waiting for a time). record(when, said): save it.
    Returns what the agent says, or None when this turn isn't about it."""
    from app.services import call_intents
    pending = state.get("meeting_pending")
    if pending is None and not call_intents.is_meeting_request(text):
        return None
    when = call_intents.callback_when(text)
    if pending is None and not when:
        state["meeting_pending"] = text[:300]
        return ("Of course, I can ask our recruitment team to arrange a meeting with you. "
                "What day and time would suit you best?")
    state.pop("meeting_pending", None)
    said = f"{pending} / {text}" if pending else text
    low = text.lower().strip()
    if pending is not None and not when and (low.endswith("?") or low.startswith(_QUESTION)):
        record("", said)                 # they moved on: keep the request, answer their question
        return None
    if pending is not None and not when:
        when = text.strip().rstrip(".")[:80]  # "the third of December", "any time": as they said it
    record(when, said)
    return (f"Lovely. I've passed your request for a meeting {_for(when)} to our recruitment team, "
            "and they'll contact you to confirm it.")


def _for(when: str) -> str:
    """"tomorrow at 11am" / "for Thursday at 2pm" / "on Monday": reads after "a meeting"."""
    w = (when or "").strip()
    if w.split(" ")[0].lower() in ("on", "at", "in", "next", "this", "tomorrow", "today", "tonight", "after",
                                   "around", "about", "by", "later", "any", "anytime"):
        return w
    return f"for {w}"


# ---- dial-pad calls: dial callbacks and voicemails again ----

def after_dialed_call(call_id: str, number: str, name: str, status: str, callback_when: str = "",
                      said: str = "") -> Optional[dict]:
    """A dial-pad call ended. A callback request or an answering machine is
    dialled again (at the time asked for / after Call Rules' voicemail
    wait), up to `callback_max` times in a row; then it is left for the team."""
    from app.services import call_rules
    parent = _for_call(call_id)
    if parent:
        update(parent["id"], status="done", result=status)
    if status not in ("callback", "voicemail") or not number or number == "unknown":
        return None
    rules = call_rules.get()
    round_no = int((parent or {}).get("round") or 0) + 1
    if status == "voicemail":
        due, when = _now() + timedelta(minutes=int(rules["voicemail_retry_minutes"])), ""
    else:
        due, when = call_rules.callback_at(callback_when), callback_when
    auto = bool(rules["callback_enabled"]) and round_no <= int(rules["callback_max"])
    note = ("" if auto else
            "Not dialled automatically: callbacks are switched off in Call Rules." if not rules["callback_enabled"] else
            f"Not dialled automatically: already called back {round_no - 1} times (Call Rules limit). Call by hand.")
    return add("callback", "dial pad", phone=number, name=name, when=when, said=said, ref=call_id, auto_dial=auto,
               round_no=round_no, due_at=due, note=("Answering machine. " if status == "voicemail" else "") + note)


def _dialling_now() -> bool:
    from app.services import inbound
    return any(getattr(s, "DIRECTION", "") == "outbound" for s in list(inbound._live.values()))


async def dial_due() -> None:
    """Place the dial-pad callbacks that are due (one at a time, in calling
    hours). Run by the outbound dialer loop every few seconds."""
    from app.services import inbound, telephony
    settings = telephony.load_settings()
    if settings.get("provider") != "sip" or not telephony.within_calling_hours(settings) or _dialling_now():
        return
    agent, loop = inbound.inbound_line.agent, inbound.inbound_line.loop
    if agent is None or loop is None:
        return
    now = _iso(_now())
    due = sorted((it for it in entries() if it.get("auto_dial") and it.get("status") == "scheduled"
                  and it.get("due_at") and it["due_at"] <= now), key=lambda it: it["due_at"])
    if not due:
        return
    it = due[0]
    try:
        call_id = inbound.dial(it["phone"], it.get("name") or "", agent, loop)
        update(it["id"], status="dialled", last_call_id=call_id, result="")
        logger.info(f"Follow-up {it['id']}: calling {it['phone']} back")
    except Exception as e:
        fails = int(it.get("dial_failures") or 0) + 1
        gave_up = fails >= DIAL_FAILURES_MAX
        update(it["id"], dial_failures=fails, note=f"Could not call: {e}"[:300],
               status="failed" if gave_up else "scheduled",
               due_at=_now() + timedelta(minutes=DIAL_RETRY_MINUTES))
        logger.warning(f"Follow-up {it['id']}: could not call {it['phone']} ({e})"
                       + ("; giving up" if gave_up else f"; trying again in {DIAL_RETRY_MINUTES} min"))
