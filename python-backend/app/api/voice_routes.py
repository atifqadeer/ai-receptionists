"""
Live voice settings (Deepgram / Cartesia) and the web app's settings
store, both kept in MySQL.

/api/voice/...   voice provider settings, voice lists, previews, key tests
/api/store/...   the web app's saved settings (what it used to keep only
                 in the browser): one JSON document per key
"""

import asyncio
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core import store
from app.services import voice

voice_engine_router = APIRouter()
store_router = APIRouter()


@voice_engine_router.get("/settings")
async def get_voice_settings():
    return await asyncio.to_thread(voice.public_settings)


@voice_engine_router.put("/settings")
async def save_voice_settings(data: dict):
    return await asyncio.to_thread(voice.update_settings, data)


@voice_engine_router.get("/voices")
async def list_voices(provider: str):
    if provider not in ("deepgram", "cartesia"):
        raise HTTPException(status_code=400, detail="provider must be deepgram or cartesia")
    try:
        return await asyncio.to_thread(voice.list_voices, provider)
    except voice.VoiceError as e:
        raise HTTPException(status_code=400, detail=str(e))


@voice_engine_router.post("/test")
async def test_voice(data: dict):
    provider = data.get("provider")
    if provider not in ("deepgram", "cartesia"):
        raise HTTPException(status_code=400, detail="provider must be deepgram or cartesia")
    return await asyncio.to_thread(voice.test_provider, provider)


@voice_engine_router.post("/speak")
async def speak(data: dict):
    """MP3 of `text` in the live voice, streamed as it is generated. 409
    when the Windows voice is selected (the web app then uses the
    browser's own speech)."""
    return await _speak(str(data.get("text") or ""), str(data.get("provider") or ""),
                        str(data.get("voice") or ""), str(data.get("model") or ""))


@voice_engine_router.get("/speak")
async def speak_get(text: str, provider: str = "", voice_id: str = "", model: str = ""):
    """The same as POST, for an <audio src=...>: the browser plays the MP3
    while it streams in."""
    return await _speak(text, provider, voice_id, model)


async def _speak(text: str, provider: str, voice_id: str, model: str):
    text = re.sub(r"\s+", " ", text).strip()[:2000]
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to say")
    s = voice.get_settings()
    provider = provider or voice.active_tts(s)
    if provider not in ("deepgram", "cartesia"):
        raise HTTPException(status_code=409, detail="No live voice provider is active")
    gen = voice.stream_speech(text, "mp3", provider=provider, voice=voice_id, model=model, chunk=4096)
    # Fetch the first chunk here, so a bad key or voice is an HTTP error
    # instead of a broken audio stream.
    try:
        first = await asyncio.to_thread(next, gen, b"")
    except voice.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except voice.VoiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{provider.title()} could not be reached: {e}")

    async def body():
        yield first
        while True:
            part = await asyncio.to_thread(next, gen, None)
            if part is None:
                break
            yield part

    return StreamingResponse(body(), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


# ---- the web app's settings ----

_KEY = re.compile(r"^[A-Za-z0-9_.:-]{1,150}$")


def _name(key: str) -> str:
    if not _KEY.match(key):
        raise HTTPException(status_code=400, detail="Invalid settings key")
    return "ui:" + key


@store_router.get("/{key}")
async def get_setting(key: str):
    value = await asyncio.to_thread(store.get_doc, _name(key))
    # exists=false: never saved (the web app then uploads its browser copy)
    return {"key": key, "value": value, "exists": value is not None}


@store_router.put("/{key}")
async def put_setting(key: str, data: dict):
    if "value" not in data:
        raise HTTPException(status_code=400, detail="Send {\"value\": ...}")
    await asyncio.to_thread(store.put_doc, _name(key), data["value"])
    return {"ok": True}


@store_router.delete("/{key}")
async def delete_setting(key: str):
    await asyncio.to_thread(store.delete_doc, _name(key))
    return {"ok": True}
