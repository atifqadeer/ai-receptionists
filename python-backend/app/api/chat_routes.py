"""
Text Simulator chat history, in MySQL: the chat_conversations and
chat_messages tables (channel "simulator", see app/core/chat_store.py).

Each chat is saved by the web app as it goes (PUT after every message), so
the history survives reloads and is the same in every browser.

GET    /api/chats          summaries, newest first (no messages)
GET    /api/chats/{id}     one chat with its messages
PUT    /api/chats/{id}     save (create or update) a chat
DELETE /api/chats/{id}     delete one chat
DELETE /api/chats          delete all chats
"""

import asyncio
import re

from fastapi import APIRouter, HTTPException

from app.core import chat_store

chats_router = APIRouter()
KIND = "simulator"         # chat_conversations.channel
MAX_MESSAGES = 500
_ID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")


def _check_id(chat_id: str) -> None:
    if not _ID.match(chat_id):
        raise HTTPException(status_code=400, detail="Invalid chat id")


def _summary(chat: dict) -> dict:
    msgs = chat.get("messages")
    if msgs is None:           # a list row: counts and last message come with it
        caller_msgs, intents, last = chat.get("visitor_message_count", 0), chat.get("intents", []), chat.get("last_message")
    else:
        talk = [m for m in msgs if m.get("sender") in ("agent", "caller")]
        last = talk[-1] if talk else None
        caller_msgs = len([m for m in msgs if m.get("sender") == "caller"])
        intents = sorted({m["intent"] for m in msgs if m.get("intent")})
    return {
        "id": chat["id"],
        "title": chat.get("title") or "New chat",
        "status": chat.get("status") or "ended",
        "started_at": chat.get("started_at"),
        "ended_at": chat.get("ended_at"),
        "duration": chat.get("duration") or 0,
        "agent_name": chat.get("agent_name") or "",
        "message_count": caller_msgs,
        "intents": intents,
        "last_message": ({"sender": last["sender"], "text": str(last.get("text", ""))[:140]} if last else None),
        "online": bool(chat.get("online")),
    }


@chats_router.get("")
async def list_chats():
    chats = await asyncio.to_thread(chat_store.load_list, KIND)
    chats.sort(key=lambda c: c.get("started_at") or "", reverse=True)
    return {"chats": [_summary(c) for c in chats]}


@chats_router.get("/{chat_id}")
async def get_chat(chat_id: str):
    _check_id(chat_id)
    chat = await asyncio.to_thread(chat_store.get_item, KIND, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


@chats_router.put("/{chat_id}")
async def save_chat(chat_id: str, data: dict):
    _check_id(chat_id)
    msgs = data.get("messages")
    if not isinstance(msgs, list):
        raise HTTPException(status_code=400, detail="messages must be a list")
    chat = {
        "id": chat_id,
        "title": str(data.get("title") or "New chat")[:120],
        "status": "active" if data.get("status") == "active" else "ended",
        "started_at": str(data.get("started_at") or "")[:40],
        "ended_at": (str(data.get("ended_at"))[:40] if data.get("ended_at") else None),
        "duration": int(data.get("duration") or 0),
        "agent_name": str(data.get("agent_name") or "")[:80],
        "company_name": str(data.get("company_name") or "")[:120],
        "online": bool(data.get("online")),
        # Numbered 1, 2, ... in order (the web app's own ids are timestamps):
        # each save adds the messages that aren't stored yet.
        "messages": [
            {**{k: m.get(k) for k in ("sender", "text", "at", "intent", "ms") if m.get(k) is not None}, "id": i}
            for i, m in enumerate([m for m in msgs if isinstance(m, dict)][:MAX_MESSAGES], start=1)
        ],
    }
    await asyncio.to_thread(chat_store.put_item, KIND, chat)
    return _summary(chat)


@chats_router.delete("/{chat_id}")
async def delete_chat(chat_id: str):
    _check_id(chat_id)
    if not await asyncio.to_thread(chat_store.delete_items, KIND, [chat_id]):
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"ok": True}


@chats_router.delete("")
async def delete_all_chats():
    return {"deleted": await asyncio.to_thread(chat_store.delete_items, KIND, None)}
