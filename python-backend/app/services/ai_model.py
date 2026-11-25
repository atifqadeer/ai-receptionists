"""
The AI model behind the agent (Settings > System > AI Model), stored in the
MySQL document "ai_model". Used straight away, no restart: chats, calls and
job-call answers all read it.

Every provider is reached through the OpenAI client with its own address
(they all offer an OpenAI-compatible API): OpenAI, Anthropic (Claude),
Google (Gemini), OpenRouter (many models with one key), Vercel AI Gateway,
xAI (Grok), Groq and Ollama (a
free model on this PC). Without a working model the agent uses its built-in
rules (knowledge base, phrase book).

The first time, an OpenAI key from .env (OPENAI_API_KEY), or one typed into
the old Integrations > AI Brain screen, is taken over.
"""

import re
import threading
import time
from typing import Optional

from loguru import logger

from app.core import store
from app.core.config import settings as app_settings

PROVIDERS = {
    "openai": {"name": "OpenAI", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini",
               "models": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"], "key_url": "https://platform.openai.com/api-keys"},
    "anthropic": {"name": "Anthropic (Claude)", "base_url": "https://api.anthropic.com/v1/", "model": "claude-sonnet-4-5",
                  "models": ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"], "key_url": "https://console.anthropic.com/settings/keys"},
    "google": {"name": "Google (Gemini)", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
               "model": "gemini-2.5-flash", "models": ["gemini-2.5-flash", "gemini-2.5-pro"], "key_url": "https://aistudio.google.com/apikey"},
    "openrouter": {"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "model": "openai/gpt-4o-mini",
                   "models": ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash"],
                   "key_url": "https://openrouter.ai/keys"},
    "vercel": {"name": "Vercel AI Gateway", "base_url": "https://ai-gateway.vercel.sh/v1", "model": "anthropic/claude-opus-5",
               "models": ["anthropic/claude-opus-5", "openai/gpt-6-astra"],
               "key_url": "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys",
               "note": "Model names are provider/model, e.g. anthropic/claude-opus-5. Use Load models for the full list."},
    "xai": {"name": "xAI (Grok)", "base_url": "https://api.x.ai/v1", "model": "grok-4.7",
            "models": ["grok-4.7", "grok-4.3"], "key_url": "https://console.x.ai/team/default/api-keys",
            "note": "Grok, from xAI (not the same as Groq). grok-4.7 is xAI's recommended model; grok-4.3 costs least."},
    "groq": {"name": "Groq", "base_url": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile",
             "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"], "key_url": "https://console.groq.com/keys"},
    "ollama": {"name": "Ollama (on this PC)", "base_url": "http://localhost:11434/v1", "model": "llama3.1",
               "models": ["llama3.1", "qwen2.5", "mistral"], "key_url": "https://ollama.com/download", "no_key": True},
    "custom": {"name": "Other (OpenAI-compatible)", "base_url": "", "model": "", "models": [], "key_url": ""},
}

DEFAULTS = {
    "enabled": True,
    "provider": "openai",
    "api_key": "",
    "base_url": "",            # blank: the provider's address
    "model": "gpt-4o-mini",
    "temperature": 0.5,
    "max_tokens": 400,
    "instructions": "",        # extra instructions added to the agent's own
    "keys": {},                # provider -> its saved key (api_key is the current provider's)
}

_cache: dict = {"at": 0.0, "value": None}
_lock = threading.Lock()
_rejected: dict = {}        # (provider, key) -> why: a key the provider refused; not used until changed
_paused: dict = {}          # (provider, key) -> (until, why): no credit / rate limit; tried again after PAUSE_SECONDS
PAUSE_SECONDS = 600


def _looks_real(key: str) -> bool:
    key = (key or "").strip()
    return len(key) >= 20 and "your" not in key.lower() and key != "sk-..."


def _first_time() -> dict:
    """No saved settings yet: take over a key from .env or the old AI Brain screen."""
    value = dict(DEFAULTS)
    old = ((store.get_doc("ui:integrations-config") or {}).get("openai") or {})
    if _looks_real(old.get("apiKey", "")):
        value["api_key"] = old["apiKey"].strip()
        logger.info("AI model: using the OpenAI key from the old Integrations > AI Brain screen")
    elif _looks_real(app_settings.OPENAI_API_KEY):
        value["api_key"] = app_settings.OPENAI_API_KEY.strip()
    store.put_doc("ai_model", value)
    return value


def get(fresh: bool = False) -> dict:
    with _lock:
        if not fresh and _cache["value"] is not None and time.time() - _cache["at"] < 3:
            return _cache["value"]
    try:
        saved = store.get_doc("ai_model")
        value = {**DEFAULTS, **saved} if saved is not None else _first_time()
    except Exception as e:
        logger.warning(f"AI model settings unavailable ({e}); using .env")
        value = {**DEFAULTS, "api_key": app_settings.OPENAI_API_KEY or ""}
    with _lock:
        _cache.update(at=time.time(), value=value)
    return value


def base_url(s: Optional[dict] = None) -> str:
    s = s or get()
    return (s.get("base_url") or "").strip() or PROVIDERS.get(s["provider"], PROVIDERS["openai"])["base_url"]


def api_key(s: Optional[dict] = None) -> str:
    s = s or get()
    key = (s.get("api_key") or "").strip()
    if not key and PROVIDERS.get(s["provider"], {}).get("no_key"):
        return "ollama"                    # the client needs some value
    return key


def available(s: Optional[dict] = None) -> bool:
    """A model is set up: switched on, a key (or a keyless local provider), a model and an address."""
    s = s or get()
    if not s.get("enabled") or not (s.get("model") or "").strip() or not base_url(s):
        return False
    if rejected_reason(s):
        return False
    return PROVIDERS.get(s["provider"], {}).get("no_key", False) or _looks_real(s.get("api_key", ""))


# No credit / quota used up: every request fails (after 1-5 s), so the agent
# stops asking for a while instead of keeping the caller waiting each turn.
_CREDIT_ERRORS = ("insufficient_quota", "credit_balance", "no credits", "billing", "exceeded your current quota",
                  "credit balance is too low", "payment required", "402")
_RATE_ERRORS = ("429", "rate limit", "rate_limit")

_KEY_ERRORS = ("401", "403", "invalid_api_key", "Incorrect API key", "expired", "model_not_found", "does not exist")


def explain(error: Exception, s: Optional[dict] = None) -> str:
    """What went wrong, in plain words (the provider's own reason where useful)."""
    s = s or get()
    name = PROVIDERS.get(s["provider"], {}).get("name", s["provider"])
    msg = str(error)
    low = msg.lower()
    if "expired" in low:
        return f"This {name} API key has expired. Create a new key on {name}'s website and paste it here."
    if "401" in msg or "invalid_api_key" in msg or "incorrect api key" in low or "unauthorized" in low:
        return f"{name} rejected this API key (wrong, revoked or for another provider). Paste a valid {name} key."
    if "403" in msg:
        return f"{name} refused the request: this key has no access to model \"{s.get('model')}\" or the account is restricted."
    if "404" in msg or "model_not_found" in msg or "does not exist" in msg:
        return f"The model \"{s.get('model')}\" was not found for this {name} account. Pick another model."
    if any(x in low for x in _CREDIT_ERRORS):
        return (f"{name} has no credit left on this account, so the agent can't use the AI model and falls back to "
                f"its built-in answers. Add credit on {name}'s billing page (it is tried again every 10 minutes).")
    if "429" in msg or "quota" in low or "insufficient" in low:
        return f"{name} refused the request: rate limit, or no credit left on this account."
    if "connection" in low or "connect" in low or "timed out" in low:
        return f"Could not reach {base_url(s)}."
    return msg[:300]


def report_failure(error: Exception) -> None:
    """A call to the model failed. A rejected key (or a model the account
    can't use) stops the agent using the model until the settings change
    (kept in MySQL, so a restart doesn't retry it); other errors (timeouts,
    outages) only affect that one answer."""
    msg = str(error)
    low = msg.lower()
    if any(x in low for x in _CREDIT_ERRORS) or any(x in low for x in _RATE_ERRORS):
        s = get()
        credit = any(x in low for x in _CREDIT_ERRORS)
        seconds = PAUSE_SECONDS if credit else 30
        _paused[(s["provider"], api_key(s))] = (time.time() + seconds, explain(error, s))
        logger.warning(f"AI model paused for {seconds}s ({'no credit' if credit else 'rate limited'}): {msg[:160]}")
        return
    if any(x in msg for x in _KEY_ERRORS):
        s = dict(get(fresh=True))
        reason = explain(error, s)
        _rejected[(s["provider"], api_key(s))] = reason
        if s.get("rejected") != reason:
            s["rejected"] = reason
            store.put_doc("ai_model", s)
            with _lock:
                _cache.update(at=time.time(), value=s)
        logger.warning(f"AI model switched off until its settings change: {msg[:160]}")


def rejected_reason(s: Optional[dict] = None) -> str:
    s = s or get()
    k = (s["provider"], api_key(s))
    paused = _paused.get(k)
    if paused and paused[0] <= time.time():
        _paused.pop(k, None)
        paused = None
    return s.get("rejected") or _rejected.get(k, "") or (paused[1] if paused else "")


def _clear_rejected(s: dict) -> dict:
    _rejected.pop((s["provider"], api_key(s)), None)
    _paused.pop((s["provider"], api_key(s)), None)
    if s.get("rejected"):
        s = {**s, "rejected": ""}
        store.put_doc("ai_model", s)
        with _lock:
            _cache.update(at=time.time(), value=s)
    return s


def _mask(v: str) -> str:
    v = (v or "").strip()
    return "" if not v else ("•" * 8 + v[-4:] if len(v) > 8 else "•" * len(v))


def public() -> dict:
    s = get(fresh=True)
    keys = {k for k, v in (s.get("keys") or {}).items() if (v or "").strip()}
    if (s.get("api_key") or "").strip():
        keys.add(s["provider"])
    s = {k: v for k, v in s.items() if k != "keys"}
    return {**s, "api_key": _mask(s.get("api_key", "")), "has_key": bool((s.get("api_key") or "").strip()),
            "providers_with_key": sorted(keys),
            "base_url_used": base_url(s), "active": available(s), "rejected": bool(rejected_reason(s)),
            "rejected_reason": rejected_reason(s),
            "providers": PROVIDERS}


def save(changes: dict) -> dict:
    s = dict(get(fresh=True))
    if changes.get("provider") in PROVIDERS and changes["provider"] != s["provider"]:
        keys = dict(s.get("keys") or {})
        if (s.get("api_key") or "").strip():
            keys[s["provider"]] = s["api_key"]          # keep it for when they switch back
        s["provider"] = changes["provider"]
        s["api_key"] = keys.get(s["provider"], "")      # never another provider's key
        s["keys"] = keys
        s["model"] = PROVIDERS[s["provider"]]["model"] or s.get("model", "")
        s["base_url"] = ""
    for k in ("model", "base_url", "instructions"):
        if k in changes:
            s[k] = str(changes[k] or "").strip()[:4000 if k == "instructions" else 300]
    if "api_key" in changes and "•" not in str(changes["api_key"] or ""):
        s["api_key"] = str(changes["api_key"] or "").strip()[:400]
        keys = dict(s.get("keys") or {})
        if s["api_key"]:
            keys[s["provider"]] = s["api_key"]
        else:
            keys.pop(s["provider"], None)
        s["keys"] = keys
    if "enabled" in changes:
        s["enabled"] = bool(changes["enabled"])
    if "temperature" in changes:
        s["temperature"] = max(0.0, min(1.0, float(changes["temperature"])))
    if "max_tokens" in changes:
        s["max_tokens"] = max(50, min(2000, int(changes["max_tokens"])))
    if s["base_url"] and not re.match(r"^https?://", s["base_url"]):
        raise ValueError("The address must start with http:// or https://")
    s["rejected"] = ""           # new settings get a fresh chance
    store.put_doc("ai_model", s)
    with _lock:
        _cache.update(at=time.time(), value=s)
    _rejected.clear()
    _paused.clear()
    return public()


# ---- clients (rebuilt when the key or address changes) ----

_clients: dict = {}


def client(sync: bool = False, timeout: float = 30.0):
    from openai import AsyncOpenAI, OpenAI
    s = get()
    k = (sync, api_key(s), base_url(s), timeout)
    c = _clients.get(k)
    if c is None:
        cls = OpenAI if sync else AsyncOpenAI
        c = cls(api_key=api_key(s), base_url=base_url(s), timeout=timeout, max_retries=0 if sync else 1)
        _clients.clear() if len(_clients) > 8 else None
        _clients[k] = c
    return c


def list_models() -> dict:
    """The models the provider offers to this key (its /models list)."""
    s = get(fresh=True)
    if not PROVIDERS.get(s["provider"], {}).get("no_key") and not (s.get("api_key") or "").strip():
        return {"ok": False, "message": "Save an API key first.", "models": []}
    try:
        page = client(sync=True, timeout=20.0).models.list()
        ids = sorted({m.id.removeprefix("models/") for m in page.data if getattr(m, "id", None)})
        return {"ok": True, "message": f"{len(ids)} models available.", "models": ids[:500]}
    except Exception as e:
        if any(x in str(e) for x in _KEY_ERRORS[:5]):
            report_failure(e)
        return {"ok": False, "message": explain(e, s), "models": []}


def test() -> dict:
    """Ask the model for a one-word reply: checks the key, model and address."""
    s = get(fresh=True)
    if not s.get("enabled"):
        return {"ok": False, "message": "The AI model is switched off."}
    if not available(s) and not rejected_reason(s):
        return {"ok": False, "message": "Add an API key and a model first."}
    s = _clear_rejected(s)      # test it again
    t = time.time()
    try:
        r = client(sync=True, timeout=20.0).chat.completions.create(
            model=s["model"], messages=[{"role": "user", "content": "Reply with the single word: OK"}],
            max_tokens=5, temperature=0)
        reply = (r.choices[0].message.content or "").strip()
        return {"ok": True, "message": f"{PROVIDERS[s['provider']]['name']} answered in {time.time() - t:.1f}s "
                                       f"with model {s['model']} (\"{reply[:20]}\").", "seconds": round(time.time() - t, 2)}
    except Exception as e:
        report_failure(e)
        return {"ok": False, "message": explain(e, s)}
