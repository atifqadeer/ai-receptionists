"""
Hung up: calls where the other person put the phone down mid-conversation,
from job calls, the dial pad and inbound calls (Hung Up page).

Built from the call history, plus any number Call Rules is still holding
because it hung up whose call has since been deleted, so the page and the
"hung up, not called again until ..." alert always agree.
"""

from datetime import datetime
from typing import Optional

from app.services import call_rules, dnc

HOLD_REASON = "hung up on the agent"


def _seconds(a: Optional[str], b: Optional[str]) -> Optional[int]:
    try:
        return max(0, int((datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds()))
    except Exception:
        return None


def _last(transcript: list, agent: bool) -> str:
    for t in reversed(transcript or []):
        if (t.get("role") == "agent") == agent and t.get("text"):
            return t["text"]
    return ""


def entries() -> list:
    from app.services import inbound, outbound
    holds = {dnc.key(h["number"]): h for h in call_rules.holds() if h.get("reason") == HOLD_REASON}
    rows = []
    for c in outbound.list_calls():
        if c.get("status") != "hung_up" and c.get("result_status") != "hung_up":
            continue
        a, j = c.get("applicant", {}), c.get("job", {}) or {}
        rows.append({
            "call_id": c["id"], "kind": "job call", "number": a.get("phone", ""),
            "name": " ".join(x for x in (a.get("first_name"), a.get("last_name")) if x),
            "job": j.get("job_title") or "", "outcome": c.get("outcome") or "",
            "at": c.get("ended_at") or c.get("updated_at") or "",
            "talk_seconds": _seconds(c.get("answered_at"), c.get("ended_at")),
            "agent_last": _last(c.get("transcript"), True), "contact_last": _last(c.get("transcript"), False),
            "turns": sum(1 for t in c.get("transcript") or [] if t.get("role") != "agent"),
        })
    for c in inbound.list_calls("inbound") + inbound.list_calls("outbound"):
        if c.get("status") != "hung_up":
            continue
        rows.append({
            "call_id": c["id"], "kind": "dial pad" if c.get("direction") == "outbound" else "inbound call",
            "number": c.get("caller_number", ""), "name": c.get("caller_name") or "", "job": "",
            "outcome": c.get("outcome") or "", "at": c.get("ended_at") or c.get("started_at") or "",
            "talk_seconds": _seconds(c.get("answered_at"), c.get("ended_at")),
            "agent_last": _last(c.get("transcript"), True), "contact_last": _last(c.get("transcript"), False),
            "turns": sum(1 for t in c.get("transcript") or [] if t.get("role") != "agent"),
        })
    seen = {dnc.key(r["number"]) for r in rows}
    for k, h in holds.items():
        if k not in seen:
            rows.append({"call_id": h.get("call_id", ""), "kind": "call", "number": h["number"], "name": "", "job": "",
                         "outcome": "", "at": h.get("since", ""), "talk_seconds": None, "agent_last": "",
                         "contact_last": "", "turns": 0})
    for r in rows:
        h = holds.get(dnc.key(r["number"]))
        r["held_until"] = h["until"] if h else None
        r["on_dnc"] = dnc.contains(r["number"]) if r["number"] else False
    return sorted(rows, key=lambda r: r["at"] or "", reverse=True)
