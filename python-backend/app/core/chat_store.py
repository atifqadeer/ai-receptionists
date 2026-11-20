"""
Chat history tables, in the MySQL database (created on start-up):

chat_conversations   one row per conversation
    channel          "website" (the chat widget on your website) or
                     "simulator" (Text Simulator in the dashboard)
    email, visitor_name, title, status, ai_enabled, origin, pages,
    started_at, last_message_at, ended_at, duration_seconds, counts and
    the last message (so lists don't need to read every message)

chat_messages        one row per message, linked to its conversation
    seq              the message number within the conversation (1, 2, ...)
    sender           visitor / agent / operator (a person) / caller / system
    body, intent, response_ms, page_url, created_at

Deleting a conversation deletes its messages (foreign key, ON DELETE
CASCADE). Times are stored in UTC.

The functions take and return a conversation as a dict with its messages
in a list, in the shape the API routes use ({"id", "email", ...,
"messages": [{"id": seq, "sender", "text", "at", ...}]}); saving inserts
only the messages not stored yet (messages never change once written).
"""

import json
from datetime import datetime, timezone
from typing import Optional

from loguru import logger
from sqlalchemy import bindparam, text

from app.core.store import engine

CHANNELS = ("website", "simulator")
_OLD_KINDS = {"widget_chats": "website", "text_chats": "simulator"}   # before these tables existed

# conversation dict key -> column
_COLUMNS = {
    "email": "email", "name": "visitor_name", "title": "title", "status": "status",
    "ai_enabled": "ai_enabled", "origin": "origin", "user_agent": "user_agent", "token_hash": "token_hash",
    "unread": "unread", "agent_name": "agent_name", "company_name": "company_name", "online": "backend_online",
    "told_waiting": "told_waiting", "duration": "duration_seconds", "ended_by": "ended_by",
}
_TIME_COLUMNS = {"started_at": "started_at", "last_at": "last_message_at", "ended_at": "ended_at"}
_TEXT_LIMITS = {"ended_by": 16, "email": 255, "visitor_name": 120, "title": 160, "status": 16, "origin": 255,
                "user_agent": 300, "token_hash": 64, "agent_name": 80, "company_name": 120}


def init() -> None:
    with engine().begin() as c:
        c.execute(text("""
            CREATE TABLE IF NOT EXISTS chat_conversations (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                channel VARCHAR(16) NOT NULL,
                email VARCHAR(255) NULL,
                visitor_name VARCHAR(120) NULL,
                title VARCHAR(160) NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'open',
                ai_enabled TINYINT(1) NOT NULL DEFAULT 1,
                origin VARCHAR(255) NULL,
                pages TEXT NULL,
                user_agent VARCHAR(300) NULL,
                token_hash CHAR(64) NULL,
                unread INT NOT NULL DEFAULT 0,
                agent_name VARCHAR(80) NULL,
                company_name VARCHAR(120) NULL,
                backend_online TINYINT(1) NOT NULL DEFAULT 0,
                told_waiting TINYINT(1) NOT NULL DEFAULT 0,
                started_at DATETIME(3) NOT NULL,
                last_message_at DATETIME(3) NULL,
                ended_at DATETIME(3) NULL,
                duration_seconds INT NOT NULL DEFAULT 0,
                message_count INT NOT NULL DEFAULT 0,
                visitor_message_count INT NOT NULL DEFAULT 0,
                last_sender VARCHAR(16) NULL,
                last_text VARCHAR(500) NULL,
                intents TEXT NULL,
                created_at DATETIME(3) NOT NULL,
                updated_at DATETIME(3) NOT NULL,
                KEY ix_chat_conv_channel (channel, started_at),
                KEY ix_chat_conv_email (channel, email),
                KEY ix_chat_conv_last (channel, last_message_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""))
        c.execute(text("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                conversation_id VARCHAR(64) NOT NULL,
                seq INT NOT NULL,
                sender VARCHAR(16) NOT NULL,
                body TEXT NOT NULL,
                intent VARCHAR(80) NULL,
                response_ms INT NULL,
                page_url VARCHAR(500) NULL,
                created_at DATETIME(3) NOT NULL,
                UNIQUE KEY uq_chat_msg_seq (conversation_id, seq),
                KEY ix_chat_msg_created (created_at),
                CONSTRAINT fk_chat_msg_conversation FOREIGN KEY (conversation_id)
                    REFERENCES chat_conversations (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""))
        # Who ended the chat: visitor / team / goodbye / inactive (added later).
        c.execute(text("ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS ended_by VARCHAR(16) NULL AFTER ended_at"))
    _move_old_chats()


def close_idle(channel: str, minutes: int) -> int:
    """Close open conversations with no message for `minutes` (they reopen
    if the visitor writes again)."""
    with engine().begin() as c:
        return c.execute(text("""UPDATE chat_conversations
                                SET status = 'closed', ended_by = 'inactive', ended_at = last_message_at, updated_at = :now
                                WHERE channel = :ch AND status = 'open'
                                  AND last_message_at < DATE_SUB(:now, INTERVAL :m MINUTE)"""),
                         {"ch": channel, "m": int(minutes), "now": _now()}).rowcount


def _move_old_chats() -> None:
    """Chats saved before these tables existed (JSON rows in the calls
    table) are moved here once."""
    with engine().connect() as c:
        rows = c.execute(text("SELECT kind, data FROM calls WHERE kind IN ('widget_chats', 'text_chats')")).all()
    if not rows:
        return
    moved = 0
    for kind, raw in rows:
        try:
            chat = json.loads(raw)
            msgs = chat.get("messages") or []
            if _OLD_KINDS[kind] == "simulator":   # simulator ids were times, not numbers 1, 2, ...
                chat["messages"] = [{**m, "id": i} for i, m in enumerate(msgs, start=1)]
            put_item(_OLD_KINDS[kind], chat)
            moved += 1
        except Exception as e:
            logger.warning(f"Could not move an old chat into chat_conversations: {e}")
    with engine().begin() as c:
        c.execute(text("DELETE FROM calls WHERE kind IN ('widget_chats', 'text_chats')"))
    logger.info(f"Moved {moved} chat(s) into the chat_conversations / chat_messages tables")


# ---- times ----

def _to_db(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo:
        d = d.astimezone(timezone.utc).replace(tzinfo=None)
    return d


def _to_iso(d: Optional[datetime]) -> Optional[str]:
    if d is None:
        return None
    return d.replace(tzinfo=timezone.utc).isoformat(timespec="milliseconds")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---- rows <-> dicts ----

def _row_to_chat(r) -> dict:
    m = r._mapping
    chat = {"id": m["id"], "channel": m["channel"]}
    for key, col in _COLUMNS.items():
        chat[key] = m[col]
    for key in ("ai_enabled", "online", "told_waiting"):
        chat[key] = bool(chat[key])
    for key, col in _TIME_COLUMNS.items():
        chat[key] = _to_iso(m[col])
    chat["pages"] = json.loads(m["pages"]) if m["pages"] else []
    chat["intents"] = json.loads(m["intents"]) if m["intents"] else []
    chat["message_count"] = m["message_count"]
    chat["visitor_message_count"] = m["visitor_message_count"]
    chat["last_message"] = {"sender": m["last_sender"], "text": m["last_text"] or ""} if m["last_sender"] else None
    return chat


def _row_to_message(r) -> dict:
    m = r._mapping
    msg = {"id": m["seq"], "sender": m["sender"], "text": m["body"], "at": _to_iso(m["created_at"])}
    if m["intent"]:
        msg["intent"] = m["intent"]
    if m["response_ms"] is not None:
        msg["ms"] = m["response_ms"]
    if m["page_url"]:
        msg["page"] = m["page_url"]
    return msg


def _messages(c, ids: list) -> dict:
    if not ids:
        return {}
    rows = c.execute(text("SELECT * FROM chat_messages WHERE conversation_id IN :ids ORDER BY conversation_id, seq")
                     .bindparams(bindparam("ids", expanding=True)), {"ids": ids}).all()
    out: dict = {i: [] for i in ids}
    for r in rows:
        out[r._mapping["conversation_id"]].append(_row_to_message(r))
    return out


# ---- the API ----

def get_item(channel: str, chat_id: str) -> Optional[dict]:
    with engine().connect() as c:
        r = c.execute(text("SELECT * FROM chat_conversations WHERE id = :i AND channel = :ch"),
                      {"i": chat_id, "ch": channel}).first()
        if not r:
            return None
        chat = _row_to_chat(r)
        chat["messages"] = _messages(c, [chat_id])[chat_id]
    return chat


def load_list(channel: str, email: Optional[str] = None, with_messages: bool = False) -> list:
    """Conversations of a channel (optionally one email's), oldest first.
    Without messages the rows still carry counts and the last message."""
    sql = "SELECT * FROM chat_conversations WHERE channel = :ch"
    params = {"ch": channel}
    if email is not None:
        sql += " AND email = :e"
        params["e"] = email
    with engine().connect() as c:
        chats = [_row_to_chat(r) for r in c.execute(text(sql + " ORDER BY started_at"), params).all()]
        if with_messages:
            msgs = _messages(c, [x["id"] for x in chats])
            for x in chats:
                x["messages"] = msgs[x["id"]]
    return chats


def put_item(channel: str, chat: dict) -> None:
    """Save a conversation: its row, and the messages not stored yet."""
    if channel not in CHANNELS:
        raise ValueError(f"Unknown chat channel {channel!r}")
    msgs = chat.get("messages") or []
    talk = [m for m in msgs if m.get("sender") in ("visitor", "caller", "agent", "operator")]
    last = talk[-1] if talk else None
    intents = sorted({m["intent"] for m in msgs if m.get("intent")})
    now = _now()
    row = {"id": str(chat["id"]), "channel": channel}
    for key, col in _COLUMNS.items():
        v = chat.get(key)
        if col in ("ai_enabled", "backend_online", "told_waiting"):
            v = 1 if (v if v is not None else col == "ai_enabled") else 0
        elif col in ("unread", "duration_seconds"):
            v = int(v or 0)
        elif v is not None:
            v = str(v)[:_TEXT_LIMITS.get(col, 500)]
        row[col] = v
    row["status"] = row["status"] or "open"
    for key, col in _TIME_COLUMNS.items():
        row[col] = _to_db(chat.get(key))
    row["started_at"] = row["started_at"] or now
    row["pages"] = json.dumps(chat.get("pages") or [], ensure_ascii=False)
    row["intents"] = json.dumps(intents, ensure_ascii=False)
    row["last_sender"] = last["sender"] if last else None
    row["last_text"] = str(last.get("text", ""))[:500] if last else None
    row["created_at"] = row["updated_at"] = now
    cols = [k for k in row]
    updates = ", ".join(f"{k} = VALUES({k})" for k in cols if k not in ("id", "channel", "created_at"))
    with engine().begin() as c:
        c.execute(text(f"INSERT INTO chat_conversations ({', '.join(cols)}) VALUES ({', '.join(':' + k for k in cols)}) "
                       f"ON DUPLICATE KEY UPDATE {updates}"), row)
        stored = c.execute(text("SELECT COALESCE(MAX(seq), 0) FROM chat_messages WHERE conversation_id = :i"),
                           {"i": row["id"]}).scalar() or 0
        new = [m for m in msgs if isinstance(m.get("id"), (int, float)) and int(m["id"]) > stored]
        if new:
            c.execute(text("""INSERT IGNORE INTO chat_messages
                              (conversation_id, seq, sender, body, intent, response_ms, page_url, created_at)
                              VALUES (:cid, :seq, :sender, :body, :intent, :ms, :page, :at)"""),
                      [{"cid": row["id"], "seq": int(m["id"]), "sender": str(m.get("sender") or "system")[:16],
                        "body": str(m.get("text") or ""), "intent": (str(m["intent"])[:80] if m.get("intent") else None),
                        "ms": int(m["ms"]) if m.get("ms") is not None else None,
                        "page": (str(m["page"])[:500] if m.get("page") else None),
                        "at": _to_db(m.get("at")) or now} for m in new])
        c.execute(text("""UPDATE chat_conversations SET
                              message_count = (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = :i),
                              visitor_message_count = (SELECT COUNT(*) FROM chat_messages
                                                       WHERE conversation_id = :i AND sender IN ('visitor', 'caller'))
                          WHERE id = :i"""), {"i": row["id"]})


def delete_items(channel: str, ids: Optional[list] = None) -> int:
    """Delete the given conversations of a channel (or all of them); their
    messages go with them."""
    with engine().begin() as c:
        if ids is None:
            return c.execute(text("DELETE FROM chat_conversations WHERE channel = :ch"), {"ch": channel}).rowcount
        if not ids:
            return 0
        return c.execute(text("DELETE FROM chat_conversations WHERE channel = :ch AND id IN :ids")
                         .bindparams(bindparam("ids", expanding=True)), {"ch": channel, "ids": ids}).rowcount


def delete_by_email(channel: str, email: str) -> int:
    with engine().begin() as c:
        return c.execute(text("DELETE FROM chat_conversations WHERE channel = :ch AND email = :e"),
                         {"ch": channel, "e": email}).rowcount
