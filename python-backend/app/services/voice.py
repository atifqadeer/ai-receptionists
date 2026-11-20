"""
The agent's live voice and hearing: Deepgram or Cartesia.

Text-to-speech (what the agent says)
- Deepgram Aura-2   POST /v1/speak, streamed
- Cartesia Sonic    POST /tts/bytes, streamed
- windows           the old offline Windows voice (sip_dialer.synthesize),
                    also the fallback when the chosen provider fails

Speech-to-text (what the caller says), for the stretch of audio the local
recogniser (Vosk) marked as the caller's answer
- Deepgram Nova-3   POST /v1/listen
- Cartesia Ink      POST /stt
- local             Whisper / Vosk on this PC (sip_dialer), also the fallback

Phone calls get 8 kHz G.711 µ-law straight from the provider (the line
format, no resampling); the web app gets MP3. Settings, API keys included,
are the MySQL document "voice"; keys from .env (DEEPGRAM_API_KEY,
CARTESIA_API_KEY) are used when none is saved.
"""

import io
import threading
import time
import wave
from typing import Iterator, Optional

import httpx
from loguru import logger

from app.core import store
from app.core.config import settings as app_settings

DEEPGRAM_API = "https://api.deepgram.com/v1"
CARTESIA_API = "https://api.cartesia.ai"
CARTESIA_VERSION = "2025-04-16"
TIMEOUT = httpx.Timeout(20.0, connect=5.0)
UNSURE = 0.55        # Deepgram transcript confidence below this: ask the caller to repeat

TTS_PROVIDERS = ("deepgram", "cartesia", "windows")
STT_PROVIDERS = ("deepgram", "cartesia", "local")

DEFAULTS = {
    "tts_provider": "deepgram",
    "stt_provider": "deepgram",
    "language": "en",
    "deepgram": {"api_key": "", "tts_voice": "aura-2-thalia-en", "stt_model": "nova-3"},
    "cartesia": {"api_key": "", "tts_model": "sonic-2", "voice_id": "", "voice_name": "",
                 "stt_model": "ink-whisper", "speed": "normal", "voice_gender": ""},
}

# Shown when the Deepgram model list can't be fetched. Aura-2 English voices.
DEEPGRAM_VOICES = [
    ("aura-2-thalia-en", "Thalia", "female", "American", "Clear, confident, energetic"),
    ("aura-2-andromeda-en", "Andromeda", "female", "American", "Casual, expressive, comfortable"),
    ("aura-2-helena-en", "Helena", "female", "American", "Caring, natural, friendly"),
    ("aura-2-asteria-en", "Asteria", "female", "American", "Clear, confident, knowledgeable"),
    ("aura-2-athena-en", "Athena", "female", "American", "Calm, smooth, professional"),
    ("aura-2-luna-en", "Luna", "female", "American", "Friendly, natural, engaging"),
    ("aura-2-hera-en", "Hera", "female", "American", "Smooth, warm, professional"),
    ("aura-2-pandora-en", "Pandora", "female", "British", "Smooth, calm, melodic"),
    ("aura-2-theia-en", "Theia", "female", "Australian", "Expressive, polite, sincere"),
    ("aura-2-apollo-en", "Apollo", "male", "American", "Confident, comfortable, casual"),
    ("aura-2-arcas-en", "Arcas", "male", "American", "Natural, smooth, clear"),
    ("aura-2-aries-en", "Aries", "male", "American", "Warm, energetic, caring"),
    ("aura-2-orion-en", "Orion", "male", "American", "Approachable, comfortable, calm"),
    ("aura-2-orpheus-en", "Orpheus", "male", "American", "Professional, clear, trustworthy"),
    ("aura-2-zeus-en", "Zeus", "male", "American", "Deep, trustworthy, smooth"),
    ("aura-2-draco-en", "Draco", "male", "British", "Warm, approachable, trustworthy"),
    ("aura-2-hyperion-en", "Hyperion", "male", "Australian", "Caring, warm, empathetic"),
]

CARTESIA_TTS_MODELS = ("sonic-2", "sonic-turbo", "sonic-3")
DEEPGRAM_STT_MODELS = ("nova-3", "nova-2")


class VoiceError(Exception):
    pass


class AuthError(VoiceError):
    """The provider rejected the API key: don't retry it on every sentence."""


# ---- settings ----

_cache: dict = {"at": 0.0, "value": None}
_cache_lock = threading.Lock()
_auth_failed: dict = {}          # provider -> key that was rejected
CACHE_SECONDS = 3.0


def _merge(base: dict, extra: dict) -> dict:
    out = dict(base)
    for k, v in (extra or {}).items():
        out[k] = _merge(base[k], v) if isinstance(base.get(k), dict) and isinstance(v, dict) else v
    return out


def get_settings(fresh: bool = False) -> dict:
    with _cache_lock:
        if not fresh and _cache["value"] is not None and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["value"]
    try:
        saved = store.get_doc("voice") or {}
    except Exception as e:
        logger.warning(f"Voice settings unavailable ({e}); using defaults")
        saved = {}
    value = _merge(DEFAULTS, saved)
    with _cache_lock:
        _cache.update(at=time.time(), value=value)
    return value


def api_key(provider: str, s: Optional[dict] = None) -> str:
    s = s or get_settings()
    key = (s.get(provider, {}).get("api_key") or "").strip()
    if not key:
        key = (app_settings.DEEPGRAM_API_KEY if provider == "deepgram" else
               getattr(app_settings, "CARTESIA_API_KEY", "")) or ""
    return key.strip()


def _key_source(provider: str, s: dict) -> str:
    if (s.get(provider, {}).get("api_key") or "").strip():
        return "saved"
    return "env" if api_key(provider, s) else ""


def _mask(v: str) -> str:
    return "" if not v else ("•" * 8 + v[-4:] if len(v) > 8 else "•" * len(v))


def public_settings() -> dict:
    s = get_settings(fresh=True)
    out = _merge(s, {})
    for p in ("deepgram", "cartesia"):
        out[p] = {**s[p], "api_key": _mask(api_key(p, s)), "key_source": _key_source(p, s),
                  "key_rejected": _auth_failed.get(p) == api_key(p, s) and bool(api_key(p, s))}
    out["tts_active"] = active_tts(s)
    out["stt_active"] = active_stt(s)
    return out


def update_settings(changes: dict) -> dict:
    s = get_settings(fresh=True)
    clean: dict = {}
    if changes.get("tts_provider") in TTS_PROVIDERS:
        clean["tts_provider"] = changes["tts_provider"]
    if changes.get("stt_provider") in STT_PROVIDERS:
        clean["stt_provider"] = changes["stt_provider"]
    for p in ("deepgram", "cartesia"):
        sub = changes.get(p)
        if not isinstance(sub, dict):
            continue
        allowed = {k: str(v)[:200] for k, v in sub.items() if k in DEFAULTS[p] and v is not None}
        if "api_key" in allowed and ("•" in allowed["api_key"]):
            allowed.pop("api_key")          # the masked value came back unchanged
        if "api_key" in allowed:
            allowed["api_key"] = allowed["api_key"].strip()
            _auth_failed.pop(p, None)
        clean[p] = allowed
    value = _merge(s, clean)
    store.put_doc("voice", value)
    with _cache_lock:
        _cache.update(at=time.time(), value=value)
    return public_settings()


def _usable(provider: str, s: dict) -> bool:
    key = api_key(provider, s)
    return bool(key) and _auth_failed.get(provider) != key


def active_tts(s: Optional[dict] = None) -> str:
    """The voice calls will actually use: the chosen provider when it has a
    working key, otherwise the Windows voice."""
    s = s or get_settings()
    p = s.get("tts_provider")
    if p == "cartesia" and not (s["cartesia"].get("voice_id")):
        return "windows"
    return p if p in ("deepgram", "cartesia") and _usable(p, s) else "windows"


def active_stt(s: Optional[dict] = None) -> str:
    s = s or get_settings()
    p = s.get("stt_provider")
    return p if p in ("deepgram", "cartesia") and _usable(p, s) else "local"


def _check(r: httpx.Response, provider: str, key: str) -> None:
    if r.status_code in (401, 403):
        _auth_failed[provider] = key
        raise AuthError(f"{provider.title()} rejected the API key ({r.status_code})")
    if r.status_code >= 400:
        try:
            detail = r.read().decode(errors="ignore")[:200]
        except Exception:
            detail = ""
        raise VoiceError(f"{provider.title()} error {r.status_code}: {detail}")


# ---- text-to-speech ----

def _deepgram_request(text: str, voice: str, fmt: str) -> tuple:
    params = {"model": voice or DEFAULTS["deepgram"]["tts_voice"]}
    if fmt == "mulaw":
        params.update(encoding="mulaw", sample_rate="8000", container="none")
    else:
        params.update(encoding="mp3")
    return f"{DEEPGRAM_API}/speak", params, {"text": text}


def _cartesia_body(text: str, s: dict, fmt: str, voice_id: str = "", model: str = "") -> dict:
    c = s["cartesia"]
    body = {
        "model_id": model or c.get("tts_model") or "sonic-2",
        "transcript": text,
        "voice": {"mode": "id", "id": voice_id or c.get("voice_id")},
        "language": s.get("language") or "en",
        "output_format": ({"container": "raw", "encoding": "pcm_mulaw", "sample_rate": 8000} if fmt == "mulaw"
                          else {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000}),
    }
    speed = c.get("speed") or "normal"
    if speed != "normal":
        if body["model_id"].startswith("sonic-3"):
            body["generation_config"] = {"speed": {"slowest": 0.6, "slow": 0.8, "fast": 1.2, "fastest": 1.5}.get(speed, 1.0)}
        else:
            body["voice"]["__experimental_controls"] = {"speed": speed}
    return body


def stream_speech(text: str, fmt: str = "mulaw", provider: str = "", voice: str = "",
                  model: str = "", chunk: int = 800) -> Iterator[bytes]:
    """Audio for `text` as it arrives from the provider: 8 kHz µ-law
    ("mulaw", for phone lines) or MP3 ("mp3", for the web app).
    `voice`/`model` override the saved choice (voice previews)."""
    s = get_settings()
    provider = provider or s["tts_provider"]
    key = api_key(provider, s)
    if provider not in ("deepgram", "cartesia"):
        raise VoiceError("No live voice provider selected")
    if not key:
        raise VoiceError(f"No {provider.title()} API key: add it in Settings > Agent > Identity & Voice")
    with httpx.Client(timeout=TIMEOUT) as client:
        if provider == "deepgram":
            url, params, body = _deepgram_request(text, voice or s["deepgram"]["tts_voice"], fmt)
            req = client.stream("POST", url, params=params, json=body,
                                headers={"Authorization": f"Token {key}"})
        else:
            if not (voice or s["cartesia"].get("voice_id")):
                raise VoiceError("Choose a Cartesia voice first")
            req = client.stream("POST", f"{CARTESIA_API}/tts/bytes", json=_cartesia_body(text, s, fmt, voice, model),
                                headers={"X-API-Key": key, "Cartesia-Version": CARTESIA_VERSION})
        with req as r:
            _check(r, provider, key)
            for part in r.iter_bytes(chunk):
                if part:
                    yield part


def synthesize(text: str, fmt: str = "mulaw") -> bytes:
    return b"".join(stream_speech(text, fmt))


# ---- speech-to-text ----

def _wav(pcm16_8k: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(pcm16_8k)
    return buf.getvalue()


def transcribe(pcm16_8k: bytes, hint: str = "") -> Optional[dict]:
    """{"text", "confidence", "engine", "seconds"} for 8 kHz 16-bit audio
    from the chosen cloud provider, or None to use the local recogniser
    (no provider chosen, no key, or the request failed)."""
    s = get_settings()
    provider = active_stt(s)
    if provider == "local" or not pcm16_8k:
        return None
    key = api_key(provider, s)
    t = time.time()
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            if provider == "deepgram":
                params = [("model", s["deepgram"].get("stt_model") or "nova-3"), ("smart_format", "true"),
                          ("punctuate", "true"), ("language", s.get("language") or "en")]
                r = client.post(f"{DEEPGRAM_API}/listen", params=params, content=_wav(pcm16_8k),
                                headers={"Authorization": f"Token {key}", "Content-Type": "audio/wav"})
                _check(r, provider, key)
                alt = (r.json().get("results", {}).get("channels") or [{}])[0].get("alternatives", [{}])[0]
                return {"text": (alt.get("transcript") or "").strip(),
                        "confidence": round(float(alt.get("confidence") or 0.0), 2),
                        "engine": "deepgram", "seconds": round(time.time() - t, 2)}
            r = client.post(f"{CARTESIA_API}/stt",
                            data={"model": s["cartesia"].get("stt_model") or "ink-whisper",
                                  "language": s.get("language") or "en"},
                            files={"file": ("answer.wav", _wav(pcm16_8k), "audio/wav")},
                            headers={"X-API-Key": key, "Cartesia-Version": CARTESIA_VERSION})
            _check(r, provider, key)
            return {"text": (r.json().get("text") or "").strip(), "confidence": 1.0,
                    "engine": "cartesia", "seconds": round(time.time() - t, 2)}
    except Exception as e:
        logger.warning(f"Speech-to-text via {provider} failed ({e}); using the local recogniser")
        return None


# ---- voices and key checks (for the settings page) ----

CATALOG_MAX_AGE = 24 * 3600
_catalog_refreshing = threading.Lock()


def _refresh_deepgram_catalog() -> None:
    """Download Deepgram's Aura-2 English voices into MySQL, in the background."""
    if not _catalog_refreshing.acquire(blocking=False):
        return                                      # already running

    def run():
        try:
            r = httpx.get(f"{DEEPGRAM_API}/models", timeout=httpx.Timeout(180.0, connect=10.0))
            r.raise_for_status()
            live = []
            for m in r.json().get("tts", []):
                cid = m.get("canonical_name") or ""
                if not cid.startswith("aura-2") or not any(l.startswith("en") for l in m.get("languages", [])):
                    continue
                meta = m.get("metadata") or {}
                tags = [t for t in (meta.get("tags") or []) if isinstance(t, str)]
                gender = next((t.lower() for t in tags if t.lower() in ("feminine", "masculine", "female", "male")), "")
                live.append({"id": cid, "name": (m.get("name") or cid).title(),
                             "gender": {"feminine": "female", "masculine": "male"}.get(gender, gender),
                             "accent": meta.get("accent") or "",
                             "description": ", ".join(t for t in tags if t.lower() not in ("feminine", "masculine"))[:80]})
            if live:
                voices = sorted({v["id"]: v for v in live}.values(), key=lambda v: (v["gender"], v["name"]))
                store.put_doc("voice_catalog:deepgram", {"at": time.time(), "voices": voices})
                logger.info(f"Deepgram voice list updated: {len(voices)} English Aura-2 voices")
        except Exception as e:
            logger.info(f"Deepgram voice list not updated ({e}); the built-in list is used")
        finally:
            _catalog_refreshing.release()

    threading.Thread(target=run, daemon=True, name="deepgram-voices").start()

def list_voices(provider: str) -> dict:
    s = get_settings()
    key = api_key(provider, s)
    if provider == "deepgram":
        # Deepgram's model list is large and can take a minute to download,
        # so it is kept in MySQL and refreshed in the background once a day;
        # until the first download, the built-in list is shown.
        catalog = store.get_doc("voice_catalog:deepgram") or {}
        if time.time() - float(catalog.get("at") or 0) > CATALOG_MAX_AGE:
            _refresh_deepgram_catalog()
        voices = catalog.get("voices") or [{"id": i, "name": n, "gender": g, "accent": a, "description": d}
                                           for i, n, g, a, d in DEEPGRAM_VOICES]
        return {"provider": "deepgram", "voices": voices, "needs_key": not key}
    if provider == "cartesia":
        if not key:
            return {"provider": "cartesia", "voices": [], "needs_key": True}
        voices, cursor = [], None
        with httpx.Client(timeout=TIMEOUT) as client:
            for _ in range(5):                       # up to 500 voices
                params = {"limit": 100}
                if cursor:
                    params["starting_after"] = cursor
                r = client.get(f"{CARTESIA_API}/voices", params=params,
                               headers={"X-API-Key": key, "Cartesia-Version": CARTESIA_VERSION})
                _check(r, "cartesia", key)
                body = r.json()
                items = body if isinstance(body, list) else body.get("data", [])
                for v in items:
                    if (v.get("language") or "en").startswith(s.get("language") or "en"):
                        voices.append({"id": v.get("id"), "name": v.get("name") or v.get("id"),
                                       "gender": (v.get("gender") or "").replace("masculine", "male").replace("feminine", "female"),
                                       "accent": "", "description": (v.get("description") or "")[:120]})
                if isinstance(body, list) or not body.get("has_more") or not items:
                    break
                cursor = items[-1].get("id")
        return {"provider": "cartesia", "voices": voices, "needs_key": False}
    raise VoiceError("Unknown provider")


def test_provider(provider: str) -> dict:
    """Synthesise a short phrase to check the key and voice."""
    t = time.time()
    try:
        audio = b"".join(stream_speech("Hello, this is a test.", "mulaw", provider=provider))
        return {"ok": True, "message": f"{provider.title()} is working ({len(audio) / 8000:.1f}s of audio in "
                                       f"{time.time() - t:.1f}s)."}
    except Exception as e:
        return {"ok": False, "message": str(e)}
