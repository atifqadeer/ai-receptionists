"""
Analytics page: real numbers from MySQL, deeper than the dashboard.

  by hour / weekday   when calls happen, answered or not
  job-call funnel     imported -> dialled -> answered -> interested
  by call type        job calls, dial pad, inbound side by side
  chats               website conversations: length, messages, how they ended
  trend               calls and chats per day (per hour for 24h)
  vs previous period  the same numbers for the period before, for the deltas
  call log            every call in the period (also as CSV)
"""

import csv
import io
import statistics
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


def _summary(calls: list, interested: int, answered_jobs: int) -> dict:
    answered = [c for c in calls if c["answered"]]
    talk = [t for t in (_talk(c) for c in answered) if t is not None]
    return {
        "calls": len(calls),
        "answered": len(answered),
        "answer_rate": round(100 * len(answered) / len(calls)) if calls else None,
        "talk_seconds": sum(talk),
        "avg_talk_seconds": round(sum(talk) / len(talk)) if talk else None,
        "longest_talk_seconds": max(talk) if talk else None,
        "conversion": round(100 * interested / answered_jobs) if answered_jobs else None,
    }


def _trend(calls: list, chat_starts: list, since: Optional[datetime], tz, hourly: bool) -> list:
    """Answered / not answered calls and chats per bucket: hours for 24h,
    days otherwise (weeks when 'all' spans more than about three months)."""
    now = datetime.now(tz)
    if hourly:
        start = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=23)
        step, fmt = timedelta(hours=1), "%H:00"
    else:
        first = since.astimezone(tz) if since else min(
            [c["started"].astimezone(tz) for c in calls]
            + [d.replace(tzinfo=timezone.utc).astimezone(tz) for d in chat_starts], default=now)
        start = first.replace(hour=0, minute=0, second=0, microsecond=0)
        step, fmt = timedelta(days=1), "%d %b"
        if (now - start).days > 92:
            start -= timedelta(days=start.weekday())
            step, fmt = timedelta(days=7), "w/c %d %b"
    n = int((now - start) / step) + 1
    out = [{"label": (start + i * step).strftime(fmt), "answered": 0, "missed": 0, "chats": 0} for i in range(n)]

    def idx(when: datetime) -> Optional[int]:
        i = int((when.astimezone(tz) - start) / step)
        return i if 0 <= i < n else None

    for c in calls:
        i = idx(c["started"])
        if i is not None:
            out[i]["answered" if c["answered"] else "missed"] += 1
    for d in chat_starts:                    # stored as naive UTC
        i = idx(d.replace(tzinfo=timezone.utc))
        if i is not None:
            out[i]["chats"] += 1
    return out


def _fill_names(calls: list) -> None:
    """Dial-pad and inbound calls often carry only a number: use the name the
    same number has on another call (a job applicant or a named caller)."""
    names: dict = {}
    for c in calls:
        if c["name"] and c["number"]:
            names.setdefault(c["number"], set()).add(c["name"].strip())
    for c in calls:
        known = names.get(c["number"]) or set()
        if not c["name"] and len({n.lower() for n in known}) == 1:   # a shared number (test extension) stays blank
            c["name"] = next(iter(known))


def _chat_count(since: datetime, until: datetime) -> int:
    with store.engine().connect() as c:
        return int(c.execute(text(
            "SELECT COUNT(*) FROM chat_conversations WHERE channel = 'website' AND started_at >= :a AND started_at < :b"),
            {"a": since.replace(tzinfo=None), "b": until.replace(tzinfo=None)}).scalar() or 0)


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
        "started": [r["started_at"] for r in rows if r["started_at"]],
        "conversations": len(rows),
        "with_email": sum(1 for r in rows if (r["email"] or "").strip()),
        "visitor_messages": sum(int(r["visitor_message_count"] or 0) for r in rows),
        "avg_messages": round(sum(int(r["message_count"] or 0) for r in rows) / len(rows), 1) if rows else None,
        # Median: one chat left open for days would swamp an average.
        "avg_length_seconds": round(statistics.median(lengths)) if lengths else None,
        "operator_joined": int(operator or 0),
        "reply_ms": round(float(avg_ms)) if avg_ms is not None else None,
        "reply_samples": int(n_ms or 0),
        "ended": [{"by": k, "count": v} for k, v in ended.most_common()],
    }


def report(period: str = "7d") -> dict:
    period = period if period in PERIODS else "7d"
    since = _since(period)
    tz = _tz()
    every = _calls()
    _fill_names(every)
    calls = [c for c in every if _in(since, c["started"])]
    calls.sort(key=lambda c: c["started"], reverse=True)

    # When calls happen.
    hours = [{"hour": h, "answered": 0, "missed": 0} for h in range(24)]
    days = [{"day": d, "answered": 0, "missed": 0} for d in WEEKDAYS]
    for c in calls:
        local = c["started"].astimezone(tz)
        key = "answered" if c["answered"] else "missed"
        hours[local.hour][key] += 1
        days[local.weekday()][key] += 1

    # Job-call funnel: applicants imported in the period, how far they got.
    all_jobs = store.load_list("outbound_calls")
    jobs = [j for j in all_jobs if _in(since, _dt(j.get("created_at")))]
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

    chats = _chats(since)
    chat_starts = chats.pop("started")

    # The same numbers for the period before this one (deltas on the tiles).
    previous = None
    if since is not None:
        before = since - PERIODS[period]
        prev_calls = [c for c in every if before <= c["started"] < since]
        prev_jobs = [j for j in all_jobs if (d := _dt(j.get("created_at"))) and before <= d < since]
        previous = _summary(prev_calls, sum(1 for j in prev_jobs if j.get("outcome") == "interested"),
                            sum(1 for j in prev_jobs if j.get("answered_at")))
        previous["chats"] = _chat_count(before, since)

    return {
        "period": period, "timezone": str(tz), "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": _summary(calls, funnel["interested"], funnel["answered"]),
        "previous": previous,
        "trend": _trend(calls, chat_starts, since, tz, hourly=period == "24h"),
        "results": [{"result": k, "count": v} for k, v in Counter(c["result"] or "unknown" for c in calls).most_common()],
        "hours": hours, "weekdays": days, "funnel": funnel, "by_kind": by_kind,
        "chats": chats, "log": log,
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
