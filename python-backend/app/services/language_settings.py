"""
Which languages the agent may use, for chats and for calls (Settings >
Agent > Languages), stored in the MySQL document "languages".

- chat:  website chat and the dashboard's test chat
- calls: phone calls (inbound, dial pad, job calls)

Guardrails: the agent only ever answers in a selected language. Someone
writing in, or asking for, another language is told (in an allowed
language) which languages it can use, and the conversation carries on in
the default language. Applied by the built-in agent (conversation.py,
outbound.py) and given to the AI model as rules (AIAgent._build_system_prompt).

English, Urdu and Roman Urdu are built in (the agent has its own wording
for them). The others need an AI model (OpenAI key) to write the replies;
without one they are not used even when selected. Calls are English only:
the phone voices and speech recognition don't speak the other languages.
"""

import time
from typing import Optional

from app.core import store

CATALOG = [
    {"id": "english", "name": "English", "native": "English", "builtin": True, "calls": True},
    {"id": "urdu", "name": "Urdu", "native": "اردو", "builtin": True, "calls": False},
    {"id": "roman_urdu", "name": "Roman Urdu", "native": "Urdu in English letters", "builtin": True, "calls": False},
    {"id": "arabic", "name": "Arabic", "native": "العربية", "builtin": False, "calls": False},
    {"id": "hindi", "name": "Hindi", "native": "हिन्दी", "builtin": False, "calls": False},
    {"id": "punjabi", "name": "Punjabi", "native": "پنجابی", "builtin": False, "calls": False},
    {"id": "spanish", "name": "Spanish", "native": "Español", "builtin": False, "calls": False},
    {"id": "french", "name": "French", "native": "Français", "builtin": False, "calls": False},
]
IDS = [c["id"] for c in CATALOG]
BY_ID = {c["id"]: c for c in CATALOG}
CALLS_NOTE = "Phone calls are English only: the phone voices and speech recognition don't speak other languages yet."

DEFAULTS = {"chat": ["english", "urdu", "roman_urdu"], "chat_default": "english", "calls": ["english"]}

_cache: dict = {"at": 0.0, "value": None}


def get(fresh: bool = False) -> dict:
    if not fresh and _cache["value"] is not None and time.time() - _cache["at"] < 3:
        return _cache["value"]
    try:
        saved = store.get_doc("languages") or {}
    except Exception:
        saved = {}
    value = {**DEFAULTS, **saved}
    _cache.update(at=time.time(), value=value)
    return value


def save(changes: dict) -> dict:
    cur = get(fresh=True)
    chat = [x for x in (changes.get("chat", cur["chat"]) or []) if x in IDS]
    calls = [x for x in (changes.get("calls", cur["calls"]) or []) if x in IDS and BY_ID[x]["calls"]]
    if not chat:
        raise ValueError("Select at least one chat language")
    if not calls:
        raise ValueError("Select at least one call language")
    default = changes.get("chat_default", cur.get("chat_default"))
    if default not in chat or not BY_ID[default]["builtin"]:
        default = next((x for x in chat if BY_ID[x]["builtin"]), chat[0])
    value = {"chat": [x for x in IDS if x in chat], "chat_default": default, "calls": [x for x in IDS if x in calls]}
    store.put_doc("languages", value)
    _cache.update(at=time.time(), value=value)
    return value


def allowed(channel: str, ai_model: bool = False) -> list:
    """The languages the agent may use on `channel` ("chat" / "calls").
    Without an AI model only the built-in ones can be written."""
    s = get()
    langs = s["chat"] if channel == "chat" else s["calls"]
    if not ai_model:
        langs = [x for x in langs if BY_ID[x]["builtin"]]
    return langs or ["english"]


def default(channel: str, ai_model: bool = False) -> str:
    langs = allowed(channel, ai_model)
    if channel == "chat":
        d = get().get("chat_default")
        if d in langs:
            return d
    return langs[0]


def names(ids: list) -> str:
    n = [BY_ID[x]["name"] for x in ids if x in BY_ID]
    return n[0] if len(n) == 1 else ", ".join(n[:-1]) + " and " + n[-1]


def prompt_rules(channel: str) -> str:
    """The language rules for the AI model."""
    langs = allowed(channel, ai_model=True)
    first = default(channel, ai_model=True)
    where = "chat" if channel == "chat" else "call"
    extra = ""
    if "urdu" in langs:
        extra += " Urdu written in Urdu script -> reply in Urdu script."
    if "roman_urdu" in langs:
        extra += " Roman Urdu (Urdu written in English letters, e.g. \"apke pas konse jobs hain\") -> reply in Roman Urdu."
    return (f"\n\nLANGUAGE RULES (strict): on this {where} you may ONLY use these languages: {names(langs)}. "
            f"Reply in the language the person writes in when it is one of them.{extra} "
            f"If they write in, or ask for, any other language, do NOT reply in that language and do not translate into it: "
            f"say politely, in {BY_ID[first]['name']}, that you can only help in {names(langs)}, then carry on in {BY_ID[first]['name']}. "
            "If they ask to switch between the allowed languages, confirm briefly and keep using the new one. "
            "Translate company facts faithfully; never change names, numbers or amounts.")
