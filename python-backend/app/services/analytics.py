"""
Analytics page: real numbers from MySQL, deeper than the dashboard.

  by hour / weekday   when calls happen, answered or not
  job-call funnel     imported -> dialled -> answered -> interested
  by call type        job calls, dial pad, inbound side by side
  chats               website conversations: length, messages, how they ended
  call log            every call in the period (also as CSV)
"""

import csv
import io
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

from app.core import store
from app.services.dashboard import _calls, _dt, _tz

PERIODS = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30),
           "90d": timedelta(days=90), "all": None}
KIND_LABEL = {"job": "Job call", "dialpad": "Dial pad", "inbound": "Inbound"}
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _since(period: str) -> Optional[datetime]:
    span = PERIODS.get(period, PERIODS["7d"])
    return datetime.now(timezone.utc) - span if span else None


def _talk(c: dict) -> Optional[int]:
    if c["answered"] and c["ended"] and c["ended"] > c["answered"]:
        return round((c["ended"] - c["answered"]).total_seconds())
    return None


def _in(since: Optional[datetime], when: Optional[datetime]) -> bool:
    return bool(when) and (since is None or when >= since)


def _chats(since: Optional[datetime]) -> dict:
    where = "channel = 'website'" + (" AND started_at >= :since" if since else "")
    p = {"since": since.replace(tzinfo=None)} if since else {}
    with store.engine().connect() as c:
        rows = [dict(r._mapping) for r in c.execute(text(
            f"SELECT status, ended_by, email, started_at, last_message_at, message_count, visitor_message_count "
            f"FROM chat_conversations WHERE {where}"), p)]
        q = ("SELECT AVG(m.response_ms), COUNT(m.response_ms) FROM chat_messages m JOIN chat_conversations c "
             "ON c.id = m.conversation_id WHERE c.channel = 'website' AND m.sender = 'agent' AND m.response_ms IS NOT NULL"
             + (" AND m.created_at >= :since" if since else ""))
        avg_ms, n_ms = c.execute(text(q), p).one()
        operator = c.execute(text(
            "SELECT COUNT(DISTINCT m.conversation_id) FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id "
            "WHERE c.channel = 'website' AND m.sender = 'operator'" + (" AND c.started_at >= :since" if since else "")), p).scalar()
    lengths = [(r["last_message_at"] - r["started_at"]).total_seconds() for r in rows
               if r["last_message_at"] and r["started_at"] and r["last_message_at"] > r["started_at"]]
    ended = Counter(("open" if r["status"] == "open" else (r["ended_by"] or "unknown")) for r in rows)
    return {
        "conversations": len(rows),
        "with_email": sum(1 for r in rows if (r["email"] or "").strip()),
        "visitor_messages": sum(int(r["visitor_message_count"] or 0) for r in rows),
        "avg_messages": round(sum(int(r["message_count"] or 0) for r in rows) / len(rows), 1) if rows else None,
        "avg_length_seconds": round(sum(lengths) / len(lengths)) if lengths else None,
        "operator_joined": int(operator or 0),
        "reply_ms": round(float(avg_ms)) if avg_ms is not None else None,
        "reply_samples": int(n_ms or 0),
        "ended": [{"by": k, "count": v} for k, v in ended.most_common()],
    }


def report(period: str = "7d") -> dict:
    period = period if period in PERIODS else "7d"
    since = _since(period)
    tz = _tz()
    calls = [c for c in _calls() if _in(since, c["started"])]
    calls.sort(key=lambda c: c["started"], reverse=True)

    answered = [c for c in calls if c["answered"]]
    talk = [t for t in (_talk(c) for c in answered) if t is not None]

    # When calls happen.
    hours = [{"hour": h, "answered": 0, "missed": 0} for h in range(24)]
    days = [{"day": d, "answered": 0, "missed": 0} for d in WEEKDAYS]
    for c in calls:
        local = c["started"].astimezone(tz)
        key = "answered" if c["answered"] else "missed"
        hours[local.hour][key] += 1
        days[local.weekday()][key] += 1

    # Job-call funnel: applicants imported in the period, how far they got.
    jobs = [j for j in store.load_list("outbound_calls") if _in(since, _dt(j.get("created_at")))]
    outcomes = Counter(j.get("outcome") or j.get("status") for j in jobs if j.get("answered_at"))
    funnel = {
        "imported": len(jobs),
        "dialled": sum(1 for j in jobs if j.get("last_attempt_at")),
        "answered": sum(1 for j in jobs if j.get("answered_at")),
        "interested": sum(1 for j in jobs if j.get("outcome") == "interested"),
        "waiting": sum(1 for j in jobs if j.get("status") == "queued"),
        "outcomes": [{"outcome": k, "count": v} for k, v in outcomes.most_common()],
    }

    # Side by side per call type.
    by_kind = []
    for k in ("job", "dialpad", "inbound"):
        cs = [c for c in calls if c["kind"] == k]
        if not cs:
            continue
        t = [x for x in (_talk(c) for c in cs) if x is not None]
        by_kind.append({
            "kind": k, "label": KIND_LABEL[k], "calls": len(cs),
            "answered": sum(1 for c in cs if c["answered"]),
            "avg_talk_seconds": round(sum(t) / len(t)) if t else None,
            "hung_up": sum(1 for c in cs if c["status"] == "hung_up"),
            "dnc": sum(1 for c in cs if c["status"] == "dnc" or c["outcome"] == "do_not_call"),
            "failed": sum(1 for c in cs if c["status"] in ("failed", "no_answer", "busy", "cancelled")),
        })

    log = [{
        "at": c["started"].isoformat(), "kind": c["kind"], "type": KIND_LABEL[c["kind"]],
        "name": c["name"], "number": c["number"], "job": c["job"],
        "status": c["status"], "outcome": c["outcome"], "result": c["result"],
        "talk_seconds": _talk(c), "attempts": c["attempts"],
    } for c in calls]

    return {
        "period": period, "timezone": str(tz),
        "summary": {
            "calls": len(calls),
            "answered": len(answered),
            "answer_rate": round(100 * len(answered) / len(calls)) if calls else None,
            "talk_seconds": sum(talk),
            "avg_talk_seconds": round(sum(talk) / len(talk)) if talk else None,
            "longest_talk_seconds": max(talk) if talk else None,
            "conversion": round(100 * funnel["interested"] / funnel["answered"]) if funnel["answered"] else None,
        },
        "hours": hours, "weekdays": days, "funnel": funnel, "by_kind": by_kind,
        "chats": _chats(since), "log": log,
    }


def report_csv(period: str = "7d") -> str:
    r = report(period)
    tz = _tz()
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Time", "Type", "Name", "Number", "Job", "Result", "Outcome", "Talk (seconds)", "Attempts"])
    for c in r["log"]:
        w.writerow([datetime.fromisoformat(c["at"]).astimezone(tz).strftime("%Y-%m-%d %H:%M"), c["type"], c["name"],
                    c["number"], c["job"], c["result"], c["outcome"], c["talk_seconds"] if c["talk_seconds"] is not None else "",
                    c["attempts"]])
    return out.getvalue()
