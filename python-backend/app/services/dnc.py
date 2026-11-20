"""
The Do Not Call list, in MySQL (document "dnc_list").

A number goes on it when someone on a call asks not to be called again
(or it is added from the dashboard). Numbers on it are never dialled: job
calls to them are not queued or are stopped, and the dial pad refuses
them. Numbers match on their last 10 digits, so +44 7700 900123 and
07700 900123 are the same number.
"""

import re
import threading
from datetime import datetime, timezone
from typing import Optional

from app.core import store

_DOC = "dnc_list"
_lock = threading.Lock()


def key(number: str) -> str:
    digits = re.sub(r"\D", "", number or "")
    return digits[-10:] if len(digits) >= 7 else digits


def _load() -> dict:
    return store.get_doc(_DOC) or {"numbers": {}}


def entries() -> list:
    """Newest first."""
    numbers = _load()["numbers"]
    return sorted(numbers.values(), key=lambda e: e.get("added_at", ""), reverse=True)


def get(number: str) -> Optional[dict]:
    k = key(number)
    return _load()["numbers"].get(k) if k else None


def contains(number: str) -> bool:
    return get(number) is not None


def add(number: str, source: str, said: str = "", call_id: str = "", name: str = "") -> dict:
    k = key(number)
    if not k:
        raise ValueError("Not a phone number")
    with _lock:
        doc = _load()
        entry = doc["numbers"].get(k) or {
            "number": number, "name": name, "added_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        entry.update(source=source, said=said[:300], call_id=call_id or entry.get("call_id", ""))
        if name and not entry.get("name"):
            entry["name"] = name
        doc["numbers"][k] = entry
        store.put_doc(_DOC, doc)
    return entry


def remove(number: str) -> bool:
    k = key(number)
    with _lock:
        doc = _load()
        if k not in doc["numbers"]:
            return False
        doc["numbers"].pop(k)
        store.put_doc(_DOC, doc)
    return True
