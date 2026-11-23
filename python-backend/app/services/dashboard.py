"""
Dashboard: real numbers from MySQL (calls table and the chat tables).

  calls     job calls (outbound_calls), dial pad and inbound calls (inbound_calls)
  chats     website chat conversations (chat_conversations, channel "website")
  replies   how fast the AI answered in chats (chat_messages.response_ms)

Periods are counted in the calling time zone (Settings > Calling), each
compared with the period before it ("today" vs yesterday, 7 days vs the
7 before, ...).
"""

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import text

from app.core import store
from app.services import call_rules, dnc, telephony

RANGES = {"today": 1, "7d": 7, "30d": 30, "all": None}
LIVE = ("dialing", "ringing", "in_progress")


def _tz() -> ZoneInfo:
    try:
        return ZoneInfo(telephony.load_settings().get("timezone") or "Europe/London")
    except Exception:
        return ZoneInfo("Europe/London")


def _dt(v) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _calls() -> list:
    """Every call that was placed or received, in one shape."""
    out = []
    for c in store.load_list("outbound_calls"):
        started = _dt(c.get("last_attempt_at"))
        if not started:
            continue                         # imported but never dialled yet
        a = c.get("applicant") or {}
        status = c.get("status") or ""
        out.append({
            "id": c["id"], "kind": "job",
            "name": " ".join(x for x in (a.get("first_name"), a.get("last_name")) if x),
            "number": a.get("phone", ""), "job": (c.get("job") or {}).get("title", ""),
            "status": status, "outcome": c.get("outcome") or "",
            "result": "interested" if c.get("outcome") == "interested" else
                      (c.get("last_result") if status == "queued" and c.get("last_result") else status),
            "started": started, "answered": _dt(c.get("answered_at")), "ended": _dt(c.get("ended_at")),
            "attempts": int(c.get("attempts") or 1),
        })
    for c in store.load_list("inbound_calls"):
        started = _dt(c.get("started_at"))
        if not started:
            continue
        out.append({
            "id": c["id"], "kind": "dialpad" if c.get("direction") == "outbound" else "inbound",
            "name": c.get("caller_name") or "", "number": c.get("caller_number") or "", "job": "",
            "status": c.get("status") or "", "outcome": c.get("outcome") or "", "result": c.get("status") or "",
            "started": started, "answered": _dt(c.get("answered_at")), "ended": _dt(c.get("ended_at")),
            "attempts": 1,
        })
    return out


def _chats(since: Optional[datetime], until: datetime) -> list:
    q = ("SELECT id, email, visitor_name, status, started_at, ended_at, duration_seconds, visitor_message_count, last_text "
         "FROM chat_conversations WHERE channel = 'website' AND started_at < :until"
         + (" AND started_at >= :since" if since else ""))
    p = {"until": until.astimezone(timezone.utc).replace(tzinfo=None)}
    if since:
        p["since"] = since.astimezone(timezone.utc).replace(tzinfo=None)
    with store.engine().connect() as c:
        return [{**dict(r._mapping), "started": _dt(r.started_at)} for r in c.execute(text(q), p)]


def _reply_ms(since: Optional[datetime], until: datetime) -> tuple:
    q = ("SELECT AVG(m.response_ms), COUNT(m.response_ms) FROM chat_messages m "
         "JOIN chat_conversations c ON c.id = m.conversation_id "
         "WHERE c.channel = 'website' AND m.sender = 'agent' AND m.response_ms IS NOT NULL AND m.created_at < :until"
         + (" AND m.created_at >= :since" if since else ""))
    p = {"until": until.astimezone(timezone.utc).replace(tzinfo=None)}
    if since:
        p["since"] = since.astimezone(timezone.utc).replace(tzinfo=None)
    with store.engine().connect() as c:
        avg, n = c.execute(text(q), p).one()
    return (round(float(avg)) if avg is not None else None), int(n or 0)


def _summary(calls: list, chats: list, since: Optional[datetime], until: datetime) -> dict:
    cs = [c for c in calls if (since is None or c["started"] >= since) and c["started"] < until]
    answered = [c for c in cs if c["answered"]]
    talk = [(c["ended"] - c["answered"]).total_seconds() for c in answered if c["ended"] and c["ended"] > c["answered"]]
    reply, reply_n = _reply_ms(since, until)
    return {
        "calls": len(cs),
        "answered": len(answered),
        "answer_rate": round(100 * len(answered) / len(cs)) if cs else None,
        "avg_talk_seconds": round(sum(talk) / len(talk)) if talk else None,
        "interested": sum(1 for c in cs if c["outcome"] == "interested"),
        "job_calls": sum(1 for c in cs if c["kind"] == "job"),
        "chats": len(chats),
        "chat_messages": sum(int(c.get("visitor_message_count") or 0) for c in chats),
        "reply_ms": reply, "reply_samples": reply_n,
        "_calls": cs,
    }


def stats(range_: str = "7d") -> dict:
    tz = _tz()
    now = datetime.now(tz)
    days = RANGES.get(range_, 7)
    today0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    calls = _calls()

    if days is None:
        since, prev_since = None, None
    else:
        since = today0 - timedelta(days=days - 1)
        prev_since = since - timedelta(days=days)
    cur = _summary(calls, _chats(since, now), since, now)
    prev = _summary(calls, _chats(prev_since, since), prev_since, since) if since else None
    cs = cur.pop("_calls")
    if prev:
        prev.pop("_calls")

    # Activity over time: by hour for today, by day for 7/30 days, by week for all.
    buckets: list = []
    if range_ == "today":
        for h in range(24):
            buckets.append({"label": f"{h:02d}:00", "start": today0 + timedelta(hours=h), "end": today0 + timedelta(hours=h + 1)})
    elif days:
        for d in range(days):
            s = since + timedelta(days=d)
            buckets.append({"label": s.strftime("%a %d" if days <= 7 else "%d %b"), "start": s, "end": s + timedelta(days=1)})
    else:
        week0 = today0 - timedelta(days=today0.weekday())
        for w in range(11, -1, -1):
            s = week0 - timedelta(weeks=w)
            buckets.append({"label": "w/c " + s.strftime("%d %b"), "start": s, "end": s + timedelta(weeks=1)})
    chats_all = _chats(buckets[0]["start"], now) if buckets else []
    series = [{
        "label": b["label"],
        "calls": sum(1 for c in calls if b["start"] <= c["started"] < b["end"]),
        "chats": sum(1 for c in chats_all if c["started"] and b["start"] <= c["started"] < b["end"]),
    } for b in buckets]

    # What happened on those calls.
    results = Counter(c["result"] or "unknown" for c in cs)
    kinds = Counter(c["kind"] for c in cs)
    hours = Counter(c["started"].astimezone(tz).hour for c in cs)
    peak = hours.most_common(1)[0] if hours else None

    # Recent activity: calls and website chats, newest first.
    recent = [{
        "type": "call", "kind": c["kind"], "name": c["name"], "number": c["number"], "job": c["job"],
        "status": c["status"], "outcome": c["outcome"], "at": c["started"].isoformat(),
        "seconds": round((c["ended"] - c["answered"]).total_seconds()) if c["answered"] and c["ended"] else None,
    } for c in calls]
    recent += [{
        "type": "chat", "kind": "website", "name": c.get("visitor_name") or "", "number": c.get("email") or "",
        "job": (c.get("last_text") or "")[:80], "status": c.get("status") or "", "outcome": "",
        "at": c["started"].isoformat() if c["started"] else "", "seconds": int(c.get("duration_seconds") or 0) or None,
    } for c in _chats(None, now)]
    recent.sort(key=lambda r: r["at"], reverse=True)

    # Right now.
    job = store.load_list("outbound_calls")
    live = sum(1 for c in job if c.get("status") in LIVE) + sum(
        1 for c in store.load_list("inbound_calls") if c.get("status") in LIVE)
    return {
        "range": range_ if range_ in RANGES else "7d",
        "timezone": str(tz),
        "current": cur,
        "previous": prev,
        "series": series,
        "results": [{"result": k, "count": v} for k, v in results.most_common()],
        "kinds": dict(kinds),
        "peak_hour": {"hour": peak[0], "calls": peak[1]} if peak else None,
        "recent": recent[:8],
        "now": {
            "live_calls": live,
            "queued": sum(1 for c in job if c.get("status") == "queued" and not c.get("scheduled_callback")),
            "callbacks": sum(1 for c in job if c.get("status") == "queued" and c.get("scheduled_callback")),
            "on_hold": len(call_rules.holds()),
            "dnc": len(dnc.entries()),
        },
    }
