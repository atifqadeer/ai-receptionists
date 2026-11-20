"""
Website chat widget: a chatbot any website can add with one script tag
in its footer:

    <script src="https://YOUR-BACKEND/widget/chatbot.js" data-key="SITE_KEY" async></script>

Visitors give their email before chatting (so every conversation can be
found by email), then the AI agent answers live from the knowledge base.
From the dashboard (Website Chat) a person can read conversations as they
happen, reply, and switch the AI off for a conversation to take over.

Public endpoints, used by the widget on other websites (/widget/...):
    GET  /widget/chatbot.js        the widget script
    GET  /widget/demo              a test page with the widget on it
    GET  /widget/config?key=       title, colours, welcome text
    POST /widget/session           start or resume a chat (email required)
    POST /widget/message           a visitor message; returns the reply
    GET  /widget/messages          new messages (a person's replies)
They check the site key, the allowed websites (when set), a per-session
token, and rate limits. Request bodies are sent as text/plain JSON so
browsers don't need a CORS preflight (see WidgetCorsMiddleware).

Dashboard endpoints (local only, like the rest of /api/):
    /api/widget/settings, /api/widget/visitors, /api/widget/conversations/...

Conversations are saved in the chat_conversations and chat_messages tables
(channel "website", see app/core/chat_store.py); settings are the MySQL
document "widget".
"""

import asyncio
import hashlib
import json
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import base64

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response
from loguru import logger

from app.core import chat_store, store
from app.services import telephony

widget_public_router = APIRouter()
widget_admin_router = APIRouter()

KIND = "website"          # chat_conversations.channel
WIDGET_JS = Path(__file__).resolve().parents[1] / "widget" / "chatbot.js"
MAX_TEXT = 1000
MAX_MESSAGES = 400
MSG_PER_MINUTE = 15
SESSIONS_PER_IP = 12            # new chats per IP per 10 minutes
ONLINE_SECONDS = 90             # a visitor polled this recently: online
IDLE_CLOSE_MINUTES = 30         # open chats with no message for this long are closed
# The visitor saying goodbye, or asking to end the chat: the chat is closed.
_GOODBYE = re.compile(
    r"^\W*(ok(ay)?|alright|thanks?( you)?|thank you|shukriya)?\W*(bye|good ?bye|bye bye|allah hafiz|khuda hafiz|"
    r"that'?s all|that is all|nothing else|no more questions)\W*((and )?thanks?( you)?( so much)?|for now)?\W*$"
    r"|\b(end|close|finish|stop|exit|quit) (the |this |my )?(chat|conversation)\b"
    r"|\bchat (band|khatam) (karo|karein|kar do)\b", re.I)
EMAIL = re.compile(r"^[^@\s<>\"']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$")

DEFAULTS = {
    "enabled": True,
    "site_key": "",
    "title": "",                # blank: the agent's company name
    "subtitle": "We typically reply in a few seconds",
    "welcome": "",              # blank: "Hi! I'm <agent> from <company>. How can I help you today?"
    "goodbye": "",              # blank: "Thanks for chatting with <company>! Have a wonderful day."
    "color": "#7c3aed",
    "position": "right",
    "ask_name": True,
    "launcher_text": "Chat with us",
    "allowed_origins": [],      # empty: any website may use the key
    # Tappable suggestions shown above the message box until the visitor's
    # first message, so they can start without typing.
    "quick_replies": ["What jobs do you have?", "How do I apply?", "What are your office hours?",
                      "Where are you located?"],
    # A short "typing..." pause before each reply appears, so the agent
    # doesn't answer inhumanly fast: off, short, natural or long.
    "typing_delay": "natural",
    "logo_version": 0,            # set when a logo is uploaded (the image is the document "widget_logo")
}

TYPING_DELAYS = {          # base ms, ms per character of the reply, cap ms
    "off": (0, 0, 0),
    "short": (300, 8, 1200),
    "natural": (700, 18, 2600),
    "long": (1200, 30, 4000),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---- settings ----

def get_settings() -> dict:
    s = {**DEFAULTS, **(store.get_doc("widget") or {})}
    if not s["site_key"]:
        s["site_key"] = "wk_" + secrets.token_urlsafe(18)
        store.put_doc("widget", s)
    return s


def _agent(request: Request):
    return request.app.state.ai_agent


def public_config(request: Request, s: dict) -> dict:
    cfg = _agent(request).get_config()
    return {
        "enabled": s["enabled"],
        "title": s["title"] or cfg.company_name or "Chat",
        "subtitle": s["subtitle"],
        "agent_name": cfg.agent_name or "Assistant",
        # The phone greeting says "thank you for calling": not for a website.
        "welcome": s["welcome"] or (f"Hi! I'm {cfg.agent_name or 'the assistant'} from {cfg.company_name or 'our team'}. "
                                    "How can I help you today?"),
        "color": s["color"] if re.fullmatch(r"#[0-9a-fA-F]{6}", s["color"] or "") else DEFAULTS["color"],
        "position": "left" if s["position"] == "left" else "right",
        "ask_name": bool(s["ask_name"]),
        "launcher_text": s["launcher_text"],
        "logo_url": f"/widget/logo?v={s['logo_version']}" if s.get("logo_version") else "",
        "quick_replies": [q for q in s.get("quick_replies") or [] if q][:6],
        "typing_delay": dict(zip(("base", "per_char", "max"),
                                 TYPING_DELAYS.get(s.get("typing_delay"), TYPING_DELAYS["natural"]))),
    }


# ---- guards for the public endpoints ----

_rate_msgs: dict = defaultdict(deque)       # session id -> times of recent messages
_rate_sessions: dict = defaultdict(deque)   # ip -> times of recent new chats
_locks: dict = defaultdict(asyncio.Lock)    # session id -> lock (read-modify-write)
_last_poll: dict = {}                        # session id -> time the widget last checked in
# Typing indicators: session id -> when the visitor / a team member last
# typed. Not stored: they only matter for a few seconds.
_visitor_typing: dict = {}
_team_typing: dict = {}
TYPING_SECONDS = 4.0             # a typing signal lasts this long


def _typing(table: dict, sid: str) -> bool:
    return time.time() - table.get(sid, 0) < TYPING_SECONDS


def _limited(bucket: deque, limit: int, window: float) -> bool:
    now = time.time()
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= limit:
        return True
    bucket.append(now)
    return False


def _origin(request: Request) -> str:
    return (request.headers.get("origin") or "").rstrip("/")


def _check_site(request: Request, key: str) -> dict:
    s = get_settings()
    if not s["enabled"]:
        raise HTTPException(status_code=403, detail="The chat is switched off")
    if not key or not secrets.compare_digest(str(key), s["site_key"]):
        raise HTTPException(status_code=403, detail="Unknown site key")
    allowed = {_site(o) for o in s.get("allowed_origins") or [] if o.strip()}
    origin = _origin(request).lower()
    if not origin:          # same-origin GETs carry no Origin header: use the page's address
        m = re.match(r"(https?://[^/]+)", request.headers.get("referer") or "")
        origin = m.group(1).lower() if m else ""
    if allowed and _site(origin) not in allowed and not _is_local(origin):
        logger.info(f"Widget refused for {origin or 'an unknown page'}: not in Allowed websites {sorted(allowed)}")
        raise HTTPException(status_code=403, detail=f"This website ({origin or 'unknown'}) is not allowed to use the chat. "
                                                    "Add it under Chat > Widget setup > Allowed websites.")
    return s


def _site(origin: str) -> str:
    """A website without "www.", so www.example.com and example.com match."""
    o = (origin or "").strip().rstrip("/").lower()
    return re.sub(r"^(https?://)www\.", r"\1", o)


def _is_local(origin: str) -> bool:
    """A page on this computer (a local copy of the website, or the backend's
    own test page): always allowed, only you can open it."""
    return bool(re.match(r"^https?://(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$", origin or ""))


async def _body(request: Request) -> dict:
    raw = await request.body()
    if len(raw) > 8000:
        raise HTTPException(status_code=413, detail="Too large")
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON")
    return data


def _load_session(session_id: str, token: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,64}", session_id or ""):
        raise HTTPException(status_code=401, detail="Invalid session")
    chat = chat_store.get_item(KIND, session_id)
    if not chat or not secrets.compare_digest(chat.get("token_hash", ""), _hash(token or "")):
        raise HTTPException(status_code=401, detail="Invalid session")
    return chat


def _visible(messages: list, after: int = 0) -> list:
    return [{k: m[k] for k in ("id", "sender", "text", "at") if k in m}
            for m in messages if m["id"] > after and m["sender"] in ("visitor", "agent", "operator", "system")]


def _add(chat: dict, sender: str, text: str, **extra) -> dict:
    msgs = chat.setdefault("messages", [])
    m = {"id": (msgs[-1]["id"] + 1) if msgs else 1, "sender": sender, "text": text, "at": _now(), **extra}
    msgs.append(m)
    del msgs[:-MAX_MESSAGES]
    chat["last_at"] = m["at"]
    return m


# ---- the AI agent ----

def _seed_history(agent, conv_id: str, chat: dict) -> None:
    """After a backend restart the agent has forgotten the conversation:
    give it back the last messages so it keeps the context."""
    if conv_id in agent.conversation_history:
        return
    history = [{"role": "system", "content": agent._build_system_prompt("chat") +
                "\n\nYou are chatting by text on the company website, not on a phone call. "
                "Keep answers short and friendly."}]
    for m in (chat.get("messages") or [])[-20:]:
        if m["sender"] == "visitor":
            history.append({"role": "user", "content": m["text"]})
        elif m["sender"] in ("agent", "operator"):
            history.append({"role": "assistant", "content": m["text"]})
    agent.conversation_history[conv_id] = history


async def _ai_reply(request: Request, chat: dict, text: str) -> Optional[str]:
    agent = _agent(request)
    conv_id = f"widget-{chat['id']}"
    # The latest visitor message is already in the chat; seed without it.
    _seed_history(agent, conv_id, {**chat, "messages": chat["messages"][:-1]})
    try:
        r = await agent.process_message(conv_id, text)
        return (r.message or "").strip() or None
    except Exception as e:
        logger.warning(f"Widget chat {chat['id'][:8]}: AI reply failed: {e}")
        return None


def _forget_idle(agent) -> None:
    """Free the agent's memory of chats idle for 30 minutes."""
    cutoff = time.time() - 1800
    for sid, at in list(_last_poll.items()):
        if at < cutoff:
            _last_poll.pop(sid, None)
            agent.conversation_history.pop(f"widget-{sid}", None)
            agent.call_state.pop(f"widget-{sid}", None)


# ---- public endpoints ----

@widget_public_router.get("/chatbot.js")
async def widget_script():
    return FileResponse(WIDGET_JS, media_type="application/javascript",
                        headers={"Cache-Control": "public, max-age=300"})


@widget_public_router.get("/demo", response_class=HTMLResponse)
async def widget_demo(key: str = ""):
    """A test page with the widget, as a website would add it."""
    key = re.sub(r"[^A-Za-z0-9_-]", "", key) or get_settings()["site_key"]
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Chat widget test page</title>
<style>body{{font-family:system-ui,sans-serif;margin:0;background:#f4f5f7;color:#1f2937}}
header{{background:#111827;color:#fff;padding:20px 32px}}main{{max-width:760px;margin:40px auto;padding:0 24px;line-height:1.6}}
footer{{text-align:center;color:#6b7280;padding:40px;font-size:14px}}</style></head>
<body><header><strong>Example Company</strong></header>
<main><h1>Widget test page</h1><p>This page shows the chat widget the way a visitor sees it on your website.
Click the chat button in the corner, enter an email address and ask a question.</p>
<p>The conversation appears in the dashboard under <b>Website Chat</b>, filed under that email address.</p></main>
<footer>Example footer
<script src="/widget/chatbot.js" data-key="{key}" async></script>
</footer></body></html>"""


@widget_public_router.get("/config")
async def widget_config(request: Request, key: str = ""):
    s = await asyncio.to_thread(_check_site, request, key)
    return public_config(request, s)


@widget_public_router.post("/session")
async def widget_session(request: Request):
    """Start a chat ({key, email, name?, page_url?}), or resume one
    ({key, session_id, token})."""
    data = await _body(request)
    s = await asyncio.to_thread(_check_site, request, data.get("key", ""))
    page = str(data.get("page_url") or "")[:500]

    if data.get("session_id"):
        try:
            chat = await asyncio.to_thread(_load_session, str(data["session_id"]), str(data.get("token") or ""))
        except HTTPException:
            raise HTTPException(status_code=401, detail="Session expired, please start again")
        async with _locks[chat["id"]]:
            chat = await asyncio.to_thread(chat_store.get_item, KIND, chat["id"])
            if page and page not in chat.get("pages", []):
                chat["pages"] = (chat.get("pages", []) + [page])[-15:]
            await asyncio.to_thread(chat_store.put_item, KIND, chat)
        _last_poll[chat["id"]] = time.time()
        return {"session_id": chat["id"], "email": chat["email"], "name": chat.get("name", ""),
                "messages": _visible(chat["messages"]), "config": public_config(request, s),
                **_ended_info(chat)}

    email = str(data.get("email") or "").strip().lower()
    if not EMAIL.match(email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    name = re.sub(r"[<>]", "", str(data.get("name") or "")).strip()[:80]
    ip = request.client.host if request.client else "?"
    if _limited(_rate_sessions[ip], SESSIONS_PER_IP, 600):
        raise HTTPException(status_code=429, detail="Too many chats started. Please try again in a few minutes.")
    token = secrets.token_urlsafe(24)
    cfg = public_config(request, s)
    chat = {
        "id": "w" + secrets.token_hex(12),
        "token_hash": _hash(token),
        "email": email,
        "name": name,
        "status": "open",
        "ai_enabled": True,
        "started_at": _now(),
        "last_at": _now(),
        "origin": _origin(request)[:200],
        "pages": [page] if page else [],
        "user_agent": (request.headers.get("user-agent") or "")[:300],
        "unread": 0,
        "messages": [],
    }
    _add(chat, "agent", cfg["welcome"])
    await asyncio.to_thread(chat_store.put_item, KIND, chat)
    _last_poll[chat["id"]] = time.time()
    logger.info(f"Widget chat started by {email} on {chat['origin'] or 'unknown site'}")
    return {"session_id": chat["id"], "token": token, "email": email, "name": name,
            "messages": _visible(chat["messages"]), "config": cfg}


def _ended_info(chat: dict) -> dict:
    """status, and whether the widget shows "chat ended" (a chat closed for
    inactivity carries on when the visitor writes again)."""
    status = chat.get("status", "open")
    return {"status": status, "ended_by": chat.get("ended_by"),
            "ended": status == "closed" and chat.get("ended_by") != "inactive"}


def _close(chat: dict, by: str, note: str) -> None:
    chat["status"] = "closed"
    chat["ended_by"] = by
    chat["ended_at"] = _now()
    _add(chat, "system", note)


@widget_public_router.post("/end")
async def widget_end(request: Request):
    """The visitor ends the chat (End chat in the widget)."""
    data = await _body(request)
    await asyncio.to_thread(_check_site, request, data.get("key", ""))
    sid = str(data.get("session_id") or "")
    await asyncio.to_thread(_load_session, sid, str(data.get("token") or ""))
    after = int(data.get("after") or 0)
    agent = _agent(request)
    async with _locks[sid]:
        chat = await asyncio.to_thread(chat_store.get_item, KIND, sid)
        if chat.get("status") != "closed" or chat.get("ended_by") == "inactive":
            _add(chat, "agent", await asyncio.to_thread(agent.chat_goodbye))
            _close(chat, "visitor", "Chat ended.")
            await asyncio.to_thread(chat_store.put_item, KIND, chat)
    agent.conversation_history.pop(f"widget-{sid}", None)
    agent.call_state.pop(f"widget-{sid}", None)
    _last_poll.pop(sid, None)
    logger.info(f"Widget chat {sid[:8]} ended by the visitor ({chat['email']})")
    return {"messages": _visible(chat["messages"], after), **_ended_info(chat)}


@widget_public_router.post("/message")
async def widget_message(request: Request):
    data = await _body(request)
    await asyncio.to_thread(_check_site, request, data.get("key", ""))
    sid, token = str(data.get("session_id") or ""), str(data.get("token") or "")
    text = re.sub(r"\s+\n", "\n", str(data.get("text") or "")).strip()[:MAX_TEXT]
    if not text:
        raise HTTPException(status_code=400, detail="Empty message")
    chat = await asyncio.to_thread(_load_session, sid, token)
    if _limited(_rate_msgs[sid], MSG_PER_MINUTE, 60):
        raise HTTPException(status_code=429, detail="You're sending messages too quickly. Please wait a moment.")
    after = int(data.get("after") or 0)
    if _ended_info(chat)["ended"]:
        raise HTTPException(status_code=409, detail="This chat has ended. Start a new chat to keep talking.")
    async with _locks[sid]:
        chat = await asyncio.to_thread(chat_store.get_item, KIND, sid)
        _add(chat, "visitor", text, page=str(data.get("page_url") or "")[:500] or None)
        _visitor_typing.pop(sid, None)
        chat["unread"] = int(chat.get("unread") or 0) + 1
        chat["status"], chat["ended_by"], chat["ended_at"] = "open", None, None
        await asyncio.to_thread(chat_store.put_item, KIND, chat)
    _last_poll[sid] = time.time()

    # "Bye" / "end the chat": say goodbye and close the chat.
    if _GOODBYE.search(text):
        agent = _agent(request)
        goodbye = await asyncio.to_thread(agent.chat_goodbye)
        async with _locks[sid]:
            chat = await asyncio.to_thread(chat_store.get_item, KIND, sid)
            _add(chat, "agent", goodbye)
            _close(chat, "goodbye", "Chat ended.")
            await asyncio.to_thread(chat_store.put_item, KIND, chat)
        agent.conversation_history.pop(f"widget-{sid}", None)
        agent.call_state.pop(f"widget-{sid}", None)
        return {"messages": _visible(chat["messages"], after), **_ended_info(chat)}

    if chat.get("ai_enabled", True):
        reply = await _ai_reply(request, chat, text)
        if not reply:
            reply = "Sorry, I couldn't answer that just now. A member of our team will get back to you by email."
        async with _locks[sid]:
            chat = await asyncio.to_thread(chat_store.get_item, KIND, sid)
            if chat.get("ai_enabled", True):          # a person may have taken over meanwhile
                _add(chat, "agent", reply)
                await asyncio.to_thread(chat_store.put_item, KIND, chat)
    else:
        async with _locks[sid]:
            chat = await asyncio.to_thread(chat_store.get_item, KIND, sid)
            if not chat.get("told_waiting"):
                chat["told_waiting"] = True
                _add(chat, "system", "A member of our team will reply here shortly.")
                await asyncio.to_thread(chat_store.put_item, KIND, chat)
    _forget_idle(_agent(request))
    return {"messages": _visible(chat["messages"], after), **_ended_info(chat)}


@widget_public_router.get("/messages")
async def widget_messages(request: Request, key: str = "", session_id: str = "", token: str = "", after: int = 0):
    await asyncio.to_thread(_check_site, request, key)
    chat = await asyncio.to_thread(_load_session, session_id, token)
    if not _ended_info(chat)["ended"]:
        _last_poll[session_id] = time.time()
    return {"messages": _visible(chat["messages"], after), **_ended_info(chat),
            "team_typing": _typing(_team_typing, session_id)}


@widget_public_router.post("/typing")
async def widget_typing(request: Request):
    """The visitor is typing ({"typing": true}) or stopped ({"typing": false})."""
    data = await _body(request)
    await asyncio.to_thread(_check_site, request, data.get("key", ""))
    sid = str(data.get("session_id") or "")
    await asyncio.to_thread(_load_session, sid, str(data.get("token") or ""))
    if data.get("typing"):
        _visitor_typing[sid] = time.time()
    else:
        _visitor_typing.pop(sid, None)
    _last_poll[sid] = time.time()
    return {"team_typing": _typing(_team_typing, sid)}


# ---- the logo ----

LOGO_MAX = 300_000
_LOGO_TYPES = {b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg", b"GIF8": "image/gif", b"RIFF": "image/webp"}


@widget_public_router.get("/logo")
async def widget_logo():
    logo = await asyncio.to_thread(store.get_doc, "widget_logo")
    if not logo:
        raise HTTPException(status_code=404, detail="No logo")
    headers = {"Cache-Control": "public, max-age=86400",
               # An uploaded SVG can't run scripts when opened on its own.
               "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
               "X-Content-Type-Options": "nosniff"}
    return Response(base64.b64decode(logo["data"]), media_type=logo["mime"], headers=headers)


# ---- dashboard endpoints ----

def _public_base() -> str:
    url = (telephony.load_settings().get("public_url") or "").strip().rstrip("/")
    return url or "http://localhost:8000"


def _summary(chat: dict) -> dict:
    msgs = chat.get("messages")
    if msgs is None:           # a list row: counts and last message come with it
        visitor_msgs, last = chat.get("visitor_message_count", 0), chat.get("last_message")
    else:
        talk = [m for m in msgs if m["sender"] in ("visitor", "agent", "operator")]
        last = talk[-1] if talk else None
        visitor_msgs = sum(1 for m in msgs if m["sender"] == "visitor")
    return {
        "id": chat["id"], "email": chat["email"], "name": chat.get("name", ""),
        "status": chat.get("status", "open"), "ended_by": chat.get("ended_by"), "ended_at": chat.get("ended_at"),
        "ai_enabled": chat.get("ai_enabled", True),
        "started_at": chat.get("started_at"), "last_at": chat.get("last_at"),
        "origin": chat.get("origin", ""), "pages": chat.get("pages", []),
        "unread": int(chat.get("unread") or 0),
        "online": time.time() - _last_poll.get(chat["id"], 0) < ONLINE_SECONDS,
        "visitor_messages": visitor_msgs,
        "visitor_typing": _typing(_visitor_typing, chat["id"]) and chat.get("status", "open") == "open",
        "last_message": {"sender": last["sender"], "text": last["text"][:140]} if last else None,
    }


@widget_admin_router.get("/settings")
async def admin_settings():
    s = await asyncio.to_thread(get_settings)
    base = await asyncio.to_thread(_public_base)
    return {**s, "logo_url": f"{base}/widget/logo?v={s['logo_version']}" if s.get("logo_version") else "",
            "script_url": f"{base}/widget/chatbot.js", "demo_url": f"{base}/widget/demo?key={s['site_key']}",
            "snippet": f'<script src="{base}/widget/chatbot.js" data-key="{s["site_key"]}" async></script>',
            "local_only": base.startswith("http://localhost")}


@widget_admin_router.put("/settings")
async def save_admin_settings(data: dict):
    s = await asyncio.to_thread(get_settings)
    for k in ("title", "subtitle", "welcome", "goodbye", "launcher_text"):
        if k in data:
            s[k] = str(data[k] or "")[:300]
    if "color" in data and re.fullmatch(r"#[0-9a-fA-F]{6}", str(data["color"])):
        s["color"] = data["color"]
    if data.get("position") in ("left", "right"):
        s["position"] = data["position"]
    if data.get("typing_delay") in TYPING_DELAYS:
        s["typing_delay"] = data["typing_delay"]
    if "quick_replies" in data:
        replies = data["quick_replies"]
        if isinstance(replies, str):
            replies = replies.splitlines()
        s["quick_replies"] = [str(q).strip()[:60] for q in replies or [] if str(q).strip()][:6]
    for k in ("enabled", "ask_name"):
        if k in data:
            s[k] = bool(data[k])
    if "allowed_origins" in data:
        origins = data["allowed_origins"]
        if isinstance(origins, str):
            origins = re.split(r"[\s,]+", origins)
        clean = []
        for o in origins or []:
            o = str(o).strip().rstrip("/")
            if not o:
                continue
            if not re.fullmatch(r"https?://[A-Za-z0-9.-]+(:\d+)?", o):
                raise HTTPException(status_code=400, detail=f"{o} is not a website address like https://www.example.com")
            clean.append(o.lower())
        s["allowed_origins"] = sorted(set(clean))
    await asyncio.to_thread(store.put_doc, "widget", s)
    return await admin_settings()


@widget_admin_router.post("/logo")
async def upload_logo(file: UploadFile = File(...)):
    """The logo shown in the chat widget: PNG, JPG, GIF, WebP or SVG, up to 300 KB."""
    data = await file.read(LOGO_MAX + 1)
    if len(data) > LOGO_MAX:
        raise HTTPException(status_code=413, detail="The logo must be 300 KB or smaller")
    mime = next((m for magic, m in _LOGO_TYPES.items() if data.startswith(magic)), None)
    if mime == "image/webp" and data[8:12] != b"WEBP":
        mime = None
    if mime is None and re.search(rb"<svg[\s>]", data[:2000], re.I):
        if re.search(rb"<script|javascript:|\son\w+\s*=", data, re.I):
            raise HTTPException(status_code=400, detail="This SVG contains scripts; please upload a plain image")
        mime = "image/svg+xml"
    if mime is None:
        raise HTTPException(status_code=400, detail="Upload a PNG, JPG, GIF, WebP or SVG image")
    await asyncio.to_thread(store.put_doc, "widget_logo", {"mime": mime, "data": base64.b64encode(data).decode()})
    s = await asyncio.to_thread(get_settings)
    s["logo_version"] = int(time.time())
    await asyncio.to_thread(store.put_doc, "widget", s)
    return await admin_settings()


@widget_admin_router.delete("/logo")
async def delete_logo():
    await asyncio.to_thread(store.delete_doc, "widget_logo")
    s = await asyncio.to_thread(get_settings)
    s["logo_version"] = 0
    await asyncio.to_thread(store.put_doc, "widget", s)
    return await admin_settings()


@widget_admin_router.post("/conversations/{chat_id}/typing")
async def team_typing(chat_id: str, data: dict):
    """A team member is typing a reply (shown in the visitor's widget)."""
    if data.get("typing"):
        _team_typing[chat_id] = time.time()
    else:
        _team_typing.pop(chat_id, None)
    return {"visitor_typing": _typing(_visitor_typing, chat_id)}


@widget_admin_router.post("/settings/rotate-key")
async def rotate_key():
    s = await asyncio.to_thread(get_settings)
    s["site_key"] = "wk_" + secrets.token_urlsafe(18)
    await asyncio.to_thread(store.put_doc, "widget", s)
    return await admin_settings()


@widget_admin_router.get("/visitors")
async def visitors():
    """Conversations grouped by email, most recent first."""
    await asyncio.to_thread(chat_store.close_idle, KIND, IDLE_CLOSE_MINUTES)
    chats = await asyncio.to_thread(chat_store.load_list, KIND)
    people: dict = {}
    for c in chats:
        sm = _summary(c)
        p = people.setdefault(c["email"], {"email": c["email"], "name": "", "conversations": 0, "messages": 0,
                                           "unread": 0, "online": False, "first_at": sm["started_at"],
                                           "last_at": sm["last_at"], "last_message": None, "ai_paused": False,
                                           "open_chats": 0, "typing": False})
        p["typing"] = p["typing"] or sm["visitor_typing"]
        p["open_chats"] += 1 if sm["status"] == "open" else 0
        p["conversations"] += 1
        p["messages"] += sm["visitor_messages"]
        p["unread"] += sm["unread"]
        p["online"] = p["online"] or sm["online"]
        p["ai_paused"] = p["ai_paused"] or not sm["ai_enabled"]
        p["name"] = p["name"] or sm["name"]
        if (sm["started_at"] or "") < (p["first_at"] or "~"):
            p["first_at"] = sm["started_at"]
        if (sm["last_at"] or "") >= (p["last_at"] or ""):
            p["last_at"], p["last_message"] = sm["last_at"], sm["last_message"]
    out = sorted(people.values(), key=lambda p: p["last_at"] or "", reverse=True)
    return {"visitors": out, "total_conversations": len(chats)}


@widget_admin_router.get("/conversations")
async def conversations(email: str):
    mine = await asyncio.to_thread(chat_store.load_list, KIND, email.strip().lower(), True)
    return {"email": email, "conversations": [{**_summary(c), "messages": c.get("messages", [])} for c in mine]}


async def _change(chat_id: str, fn) -> dict:
    async with _locks[chat_id]:
        chat = await asyncio.to_thread(chat_store.get_item, KIND, chat_id)
        if not chat:
            raise HTTPException(status_code=404, detail="Conversation not found")
        fn(chat)
        await asyncio.to_thread(chat_store.put_item, KIND, chat)
    return {**_summary(chat), "messages": chat.get("messages", [])}


@widget_admin_router.post("/conversations/{chat_id}/reply")
async def operator_reply(chat_id: str, data: dict):
    """A person replies; the AI stops answering this conversation."""
    text = str(data.get("text") or "").strip()[:MAX_TEXT * 2]
    if not text:
        raise HTTPException(status_code=400, detail="Empty reply")

    def go(chat):
        if chat.get("ai_enabled", True):
            chat["ai_enabled"] = False
            _add(chat, "system", "You're now chatting with a member of our team.")
        _add(chat, "operator", text)
        _team_typing.pop(chat["id"], None)
        chat["unread"] = 0
    return await _change(chat_id, go)


@widget_admin_router.put("/conversations/{chat_id}")
async def update_conversation(chat_id: str, data: dict):
    def go(chat):
        if "ai_enabled" in data:
            on = bool(data["ai_enabled"])
            if on and not chat.get("ai_enabled", True):
                _add(chat, "system", "You're chatting with our AI assistant again.")
                chat["told_waiting"] = False
            chat["ai_enabled"] = on
        if data.get("read"):
            chat["unread"] = 0
        if data.get("status") == "closed" and chat.get("status") != "closed":
            _close(chat, "team", "This chat was closed by our team. Thank you for chatting with us!")
        elif data.get("status") == "open" and chat.get("status") == "closed":
            chat["status"], chat["ended_by"], chat["ended_at"] = "open", None, None
            _add(chat, "system", "This chat was reopened by our team.")
    return await _change(chat_id, go)


@widget_admin_router.delete("/conversations/{chat_id}")
async def delete_conversation(chat_id: str):
    if not await asyncio.to_thread(chat_store.delete_items, KIND, [chat_id]):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@widget_admin_router.delete("/visitors/{email}")
async def delete_visitor(email: str):
    n = await asyncio.to_thread(chat_store.delete_by_email, KIND, email.strip().lower())
    return {"deleted": n}


# ---- CORS for the widget's public endpoints ----

class WidgetCorsMiddleware:
    """The widget runs on other websites: /widget/... answers any origin
    (the site key and allowed-websites list are checked per request). No
    cookies are used, so no credentials are allowed."""

    HEADERS = [(b"access-control-allow-origin", b"*"),
               (b"access-control-allow-methods", b"GET, POST, OPTIONS"),
               (b"access-control-allow-headers", b"content-type"),
               (b"access-control-max-age", b"600"),
               # Chrome asks before a public website reaches a backend on this
               # computer (private network access): allow it.
               (b"access-control-allow-private-network", b"true")]

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/widget/"):
            return await self.app(scope, receive, send)
        if scope["method"] == "OPTIONS":
            await send({"type": "http.response.start", "status": 204, "headers": self.HEADERS})
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_with_cors(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", [])
                           if k.lower() not in (b"access-control-allow-origin", b"access-control-allow-credentials")]
                message = {**message, "headers": headers + self.HEADERS}
            await send(message)

        return await self.app(scope, receive, send_with_cors)
