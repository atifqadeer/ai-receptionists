"""
Not interested: contacts who said on a call that they are not interested,
in MySQL (document "not_interested_list"). Shown under the Do Not Call list.

Unlike the Do Not Call list this is a record, not a block: the number is
only held for Settings > Call Rules > "not interested" days (see
call_rules.after_call), and is kept here afterwards so you can see who
turned a role down. Numbers match like the Do Not Call list (last 10
digits); a second "not interested" updates the entry and counts it.
"""

import threading
from datetime import datetime, timezone

from app.core import store
from app.services import dnc

_DOC = "not_interested_list"
_lock = threading.Lock()


def _load() -> dict:
    doc = store.get_doc(_DOC)
    if doc is None:
        doc = _backfill()
    return doc


def _backfill() -> dict:
    """First use: fill the list from the calls already marked not interested."""
    from app.services import inbound, outbound
    numbers: dict = {}
    try:
        for c in outbound.list_calls():
            if c.get("status") != "not_interested" and c.get("outcome") != "not_interested":
                continue
            a = c.get("applicant", {})
            said = next((n.get("applicant", "") for n in reversed(c.get("notes") or []) if n.get("kind") == "decision"), "")
            name = " ".join(x for x in (a.get("first_name"), a.get("last_name")) if x)
            _put(numbers, a.get("phone", ""), c.get("ended_at") or c.get("updated_at") or "", "job call", said,
                 c.get("id", ""), name, (c.get("job") or {}).get("job_title") or "")
        for c in inbound.list_calls("inbound") + inbound.list_calls("outbound"):
            if c.get("status") != "not_interested":
                continue
            said = next((t.get("text", "") for t in reversed(c.get("transcript") or []) if t.get("role") != "agent"), "")
            _put(numbers, c.get("caller_number", ""), c.get("ended_at") or c.get("started_at") or "",
                 "dial pad" if c.get("direction") == "outbound" else "inbound call", said, c.get("id", ""),
                 c.get("caller_name") or "", "")
    except Exception:
        pass
    doc = {"numbers": numbers}
    store.put_doc(_DOC, doc)
    return doc


def _put(numbers: dict, number: str, at: str, source: str, said: str, call_id: str, name: str, job: str) -> None:
    k = dnc.key(number)
    if not k or number == "unknown":
        return
    old = numbers.get(k)
    if old and old["at"] >= at:
        old["times"] += 1
        return
    numbers[k] = {"number": number, "name": name or (old or {}).get("name", ""), "first_at": (old or {}).get("first_at", at),
                  "at": at, "times": (old or {}).get("times", 0) + 1, "source": source, "call_id": call_id,
                  "said": said[:300], "job": job[:120]}


def _sync_holds(active: list) -> dict:
    """Every number Call Rules is holding because they said they're not
    interested is on the list, even when the hold came from before the list
    existed or its call has been deleted from the history."""
    with _lock:
        doc = _load()
        missing = [h for h in active if h.get("reason") == "said they are not interested"
                   and dnc.key(h["number"]) and dnc.key(h["number"]) not in doc["numbers"]]
        if missing:
            calls = _calls_by_id({h.get("call_id") for h in missing})
            for h in missing:
                c = calls.get(h.get("call_id")) or {}
                _put(doc["numbers"], h["number"], (h.get("since") or "")[:19] + "+00:00",
                     c.get("source", "call"), c.get("said", ""), h.get("call_id", ""), c.get("name", ""), c.get("job", ""))
            store.put_doc(_DOC, doc)
        return doc["numbers"]


def _calls_by_id(ids: set) -> dict:
    """Name, job and last words for the calls still in the history."""
    from app.services import inbound, outbound
    out = {}
    try:
        for c in outbound.list_calls():
            if c.get("id") in ids:
                a = c.get("applicant", {})
                out[c["id"]] = {"source": "job call", "name": " ".join(x for x in (a.get("first_name"), a.get("last_name")) if x),
                                "job": (c.get("job") or {}).get("job_title") or "",
                                "said": next((n.get("applicant", "") for n in reversed(c.get("notes") or [])
                                              if n.get("kind") == "decision"), "")}
        for c in inbound.list_calls("inbound") + inbound.list_calls("outbound"):
            if c.get("id") in ids:
                out[c["id"]] = {"source": "dial pad" if c.get("direction") == "outbound" else "inbound call",
                                "name": c.get("caller_name") or "", "job": "",
                                "said": next((t.get("text", "") for t in reversed(c.get("transcript") or [])
                                              if t.get("role") != "agent"), "")}
    except Exception:
        pass
    return out


def entries() -> list:
    """Newest first, each with `held_until` while Call Rules still holds the number."""
    from app.services import call_rules
    active = call_rules.holds()
    holds = {dnc.key(h["number"]): h["until"] for h in active}
    numbers = _sync_holds(active)
    out = []
    for k, e in numbers.items():
        out.append({**e, "held_until": holds.get(k), "on_dnc": dnc.contains(e["number"])})
    return sorted(out, key=lambda e: e.get("at", ""), reverse=True)


def add(number: str, source: str, said: str = "", call_id: str = "", name: str = "", job: str = "") -> dict:
    k = dnc.key(number)
    if not k or number == "unknown":
        raise ValueError("Not a phone number")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _lock:
        doc = _load()
        entry = doc["numbers"].get(k) or {"number": number, "name": name, "first_at": now, "times": 0}
        entry.update(at=now, source=source, call_id=call_id or entry.get("call_id", ""),
                     times=int(entry.get("times") or 0) + 1)
        if said:
            entry["said"] = said[:300]
        if job:
            entry["job"] = job[:120]
        if name:
            entry["name"] = name
        doc["numbers"][k] = entry
        store.put_doc(_DOC, doc)
    return entry


def remove(number: str) -> bool:
    k = dnc.key(number)
    with _lock:
        doc = _load()
        if k not in doc["numbers"]:
            return False
        doc["numbers"].pop(k)
        store.put_doc(_DOC, doc)
    return True
