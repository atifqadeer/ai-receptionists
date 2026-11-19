"""
VoIP telephony - provider settings and outbound call placement.

Supported providers (all speak to the caller and hear the reply through
webhooks, so the AI agent can hold a conversation on the call):

- Twilio      REST API + TwiML <Gather input="speech">
- SignalWire  Twilio-compatible LaML API (same TwiML)
- Telnyx      TeXML API (Twilio-compatible XML)
- Vonage      Voice API (JWT-signed) + NCCO speech input

Settings (credentials included) are stored in data/telephony.json next to
the agent config. Secrets are never returned to the dashboard in full.
"""

import asyncio
import json
import re
import secrets
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

import httpx
from loguru import logger

_SETTINGS_FILE = Path(__file__).resolve().parents[2] / "data" / "telephony.json"

# Credential fields per provider. "secret" fields are masked when read.
PROVIDERS = {
    "twilio": {
        "name": "Twilio",
        "fields": [
            {"key": "account_sid", "label": "Account SID", "placeholder": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},
            {"key": "auth_token", "label": "Auth Token", "secret": True},
        ],
        "voice": "Polly.Amy",
    },
    "signalwire": {
        "name": "SignalWire",
        "fields": [
            {"key": "space_url", "label": "Space URL", "placeholder": "yourspace.signalwire.com"},
            {"key": "project_id", "label": "Project ID"},
            {"key": "api_token", "label": "API Token", "secret": True},
        ],
        "voice": "Polly.Amy",
    },
    "telnyx": {
        "name": "Telnyx",
        "fields": [
            {"key": "api_key", "label": "API Key", "secret": True, "placeholder": "KEYxxxxxxxx"},
            {"key": "texml_app_id", "label": "TeXML Application ID"},
        ],
        "voice": "female",
    },
    # A SIP account on your own PBX - the same details a softphone such as
    # MicroSIP uses. The backend registers and calls directly (sip_dialer.py).
    "sip": {
        "name": "SIP Account (Asterisk, FreeSWITCH, 3CX, ...)",
        "fields": [
            {"key": "server", "label": "SIP Server / Domain", "placeholder": "192.168.1.10 or pbx.example.com"},
            {"key": "port", "label": "SIP Port", "placeholder": "5060", "optional": True},
            {"key": "username", "label": "Username / Extension", "placeholder": "308"},
            {"key": "password", "label": "Password", "secret": True},
            {"key": "local_port", "label": "Local SIP port on this PC", "placeholder": "5062", "optional": True},
            {"key": "outside_prefix", "label": "Outside-line prefix for phone numbers", "placeholder": "e.g. 9 (blank if none)", "optional": True},
        ],
        "voice": "",
    },
    "vonage": {
        "name": "Vonage",
        "fields": [
            {"key": "application_id", "label": "Application ID"},
            {"key": "private_key", "label": "Private Key (contents of private.key)", "secret": True, "multiline": True},
        ],
        "voice": "",
    },
}

DEFAULT_SETTINGS = {
    "provider": "twilio",
    "credentials": {},              # provider -> {field: value}
    "from_number": "",              # caller ID, E.164 (+44...)
    "public_url": "",               # https URL the provider can reach (e.g. ngrok)
    "default_country_code": "+44",  # for local numbers like 07700 900123
    "call_mode": "auto",            # "auto" or "manual"
    "calling_hours_start": "09:00",
    "calling_hours_end": "19:00",
    "calling_days": [0, 1, 2, 3, 4],   # Monday=0
    "timezone": "Europe/London",
    "max_concurrent_calls": 2,
    "max_attempts": 2,
    "retry_minutes": 60,
    "language": "en-GB",
    "voice": "",
    "result_webhook_url": "",       # outcome of each call is POSTed here (your CRM)
    # Pull applicants from your CRM's API (GET, JSON array) and queue a call
    # for each new one; see outbound.pull_from_crm.
    "crm_api_url": "",              # e.g. http://127.0.0.1:8100/api/v1/applicants?status=new
    "crm_api_key": "",              # sent as "Authorization: Bearer ..." and "X-API-Key"
    "crm_poll_minutes": 0,          # 0 = only when "Fetch now" is pressed
    "sip_domain": "",               # PBX domain for extensions: 1234 -> sip:1234@sip_domain
    "webhook_token": "",            # required on incoming CRM webhooks
    # Incoming calls: the agent registers this extension on the PBX and
    # answers every call to it (see app/services/inbound.py).
    "inbound": {},
}

DEFAULT_INBOUND = {
    "enabled": False,
    "extension": "",        # e.g. 428: the number people dial
    "password": "",         # that extension's SIP password
    "server": "",           # blank: the SIP Account's server
    "port": "",             # blank: the SIP Account's port, else 5060
    "local_port": "5064",   # this PC's port for the inbound line (outbound uses 5062)
    "greeting": "",         # blank: the agent's greeting from Agent Setup
    "max_concurrent": 2,    # more calls at once get "busy"
    "max_minutes": 15,      # longest call
}


def inbound_settings(settings: dict) -> dict:
    return {**DEFAULT_INBOUND, **(settings.get("inbound") or {})}


class TelephonyError(Exception):
    pass


# ---- settings ----

def load_settings() -> dict:
    data = {}
    try:
        if _SETTINGS_FILE.exists():
            data = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"Could not read telephony settings: {e}")
    settings = {**DEFAULT_SETTINGS, **data}
    if not settings.get("webhook_token"):
        settings["webhook_token"] = secrets.token_urlsafe(24)
        save_settings(settings)
    return settings


def save_settings(settings: dict) -> None:
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(json.dumps(settings, indent=2), encoding="utf-8")


def _mask(value: str) -> str:
    if not value:
        return ""
    return "•" * 8 + value[-4:] if len(value) > 8 else "•" * len(value)


def public_settings(settings: dict) -> dict:
    """Settings for the dashboard: secret fields masked."""
    out = json.loads(json.dumps(settings))
    for pid, creds in out.get("credentials", {}).items():
        for f in PROVIDERS.get(pid, {}).get("fields", []):
            if f.get("secret") and creds.get(f["key"]):
                creds[f["key"]] = _mask(creds[f["key"]])
    if out.get("crm_api_key"):
        out["crm_api_key"] = _mask(out["crm_api_key"])
    inbound = inbound_settings(out)
    if inbound.get("password"):
        inbound["password"] = _mask(inbound["password"])
    out["inbound"] = inbound
    out["providers"] = {pid: {"name": p["name"], "fields": p["fields"]} for pid, p in PROVIDERS.items()}
    out["configured"] = is_configured(settings)
    return out


def update_settings(changes: dict) -> dict:
    """Merge dashboard changes. A masked secret sent back unchanged keeps
    the stored value."""
    settings = load_settings()
    creds_in = changes.pop("credentials", None) or {}
    inbound_in = changes.pop("inbound", None)
    for key in DEFAULT_SETTINGS:
        if key in changes and key not in ("credentials", "webhook_token", "inbound"):
            if key == "crm_api_key" and str(changes[key] or "").startswith("•"):
                continue  # unchanged masked value
            settings[key] = changes[key].strip() if isinstance(changes[key], str) else changes[key]
    if isinstance(inbound_in, dict):
        inbound = inbound_settings(settings)
        for key in DEFAULT_INBOUND:
            if key not in inbound_in:
                continue
            value = inbound_in[key]
            if isinstance(value, str):
                value = value.strip()
                if key == "password" and value.startswith("•"):
                    continue  # unchanged masked value
            inbound[key] = value
        settings["inbound"] = inbound
    for pid, creds in creds_in.items():
        if pid not in PROVIDERS:
            continue
        stored = settings["credentials"].setdefault(pid, {})
        for f in PROVIDERS[pid]["fields"]:
            if f["key"] not in creds:
                continue
            value = (creds[f["key"]] or "").strip() if not f.get("multiline") else (creds[f["key"]] or "").strip()
            if f.get("secret") and value.startswith("•"):
                continue  # unchanged masked value
            stored[f["key"]] = value
    settings["public_url"] = (settings.get("public_url") or "").strip().rstrip("/")
    settings["from_number"] = normalize_phone(settings.get("from_number") or "", settings["default_country_code"]) or (settings.get("from_number") or "").strip()
    save_settings(settings)
    return settings


def regenerate_webhook_token() -> str:
    settings = load_settings()
    settings["webhook_token"] = secrets.token_urlsafe(24)
    save_settings(settings)
    return settings["webhook_token"]


def missing_settings(settings: dict) -> list:
    """What still has to be filled in before calls can be placed."""
    missing = []
    pid = settings.get("provider")
    creds = settings.get("credentials", {}).get(pid, {})
    for f in PROVIDERS.get(pid, {}).get("fields", []):
        if not f.get("optional") and not creds.get(f["key"]):
            missing.append(f["label"])
    if pid == "sip":
        # Calls go straight to the PBX: the caller ID is the SIP account and
        # no public URL is needed.
        return missing
    if not settings.get("from_number"):
        missing.append("Caller ID number")
    if not (settings.get("public_url") or "").startswith("https://"):
        missing.append("Public webhook URL (https)")
    return missing


def is_configured(settings: dict) -> bool:
    return not missing_settings(settings)


# ---- phone numbers and calling hours ----

EXTENSION_RE = re.compile(r"\d{3,6}")


def is_extension(number: str) -> bool:
    """A PBX extension such as "204" or "1234" (3 to 6 digits, no +)."""
    return bool(EXTENSION_RE.fullmatch(number or ""))


def normalize_phone(raw: str, country_code: str = "+44") -> Optional[str]:
    """E.164 form of a phone number: "07700 900123" -> "+447700900123".
    A 3-6 digit extension ("1234", "ext 204") is kept as its digits."""
    if not raw:
        return None
    s = re.sub(r"[^\d+]", "", str(raw).strip())
    if is_extension(s):
        return s
    if s.startswith("00"):
        s = "+" + s[2:]
    if not s.startswith("+"):
        cc = re.sub(r"\D", "", country_code or "")
        if s.startswith(cc) and len(s) > 10:
            s = "+" + s
        else:
            s = "+" + cc + s.lstrip("0")
    digits = re.sub(r"\D", "", s)
    if not 8 <= len(digits) <= 15:
        return None
    return "+" + digits


def within_calling_hours(settings: dict, now: Optional[datetime] = None) -> bool:
    try:
        tz = ZoneInfo(settings.get("timezone") or "Europe/London")
    except Exception:
        tz = ZoneInfo("Europe/London")
    now = (now or datetime.now(tz)).astimezone(tz)
    if now.weekday() not in (settings.get("calling_days") or [0, 1, 2, 3, 4]):
        return False
    hm = now.strftime("%H:%M")
    return (settings.get("calling_hours_start") or "00:00") <= hm < (settings.get("calling_hours_end") or "23:59")


# ---- speech responses (what the provider says and listens for) ----

def _voice(settings: dict) -> str:
    return settings.get("voice") or PROVIDERS.get(settings.get("provider"), {}).get("voice", "")


def say_and_listen(settings: dict, text: str, action_url: str, no_input_url: str) -> tuple:
    """(body, media_type) that speaks `text` and posts the caller's reply
    to action_url; if the caller says nothing, no_input_url is requested."""
    lang = settings.get("language") or "en-GB"
    if settings.get("provider") == "vonage":
        ncco = [
            {"action": "talk", "text": text, "language": lang, "bargeIn": True},
            {"action": "input", "type": ["speech"], "eventUrl": [action_url], "eventMethod": "POST",
             "speech": {"language": lang, "endOnSilence": 1.5, "maxDuration": 30}},
        ]
        return json.dumps(ncco), "application/json"
    voice = _voice(settings)
    voice_attr = f' voice="{escape(voice)}"' if voice else ""
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?><Response>'
        f'<Gather input="speech" action="{escape(action_url)}" method="POST" speechTimeout="auto" '
        f'timeout="6" language="{escape(lang)}">'
        f'<Say{voice_attr} language="{escape(lang)}">{escape(text)}</Say></Gather>'
        f'<Redirect method="POST">{escape(no_input_url)}</Redirect></Response>'
    )
    return xml, "application/xml"


def say_and_hangup(settings: dict, text: str) -> tuple:
    lang = settings.get("language") or "en-GB"
    if settings.get("provider") == "vonage":
        return json.dumps([{"action": "talk", "text": text, "language": lang}]), "application/json"
    voice = _voice(settings)
    voice_attr = f' voice="{escape(voice)}"' if voice else ""
    xml = ('<?xml version="1.0" encoding="UTF-8"?><Response>'
           f'<Say{voice_attr} language="{escape(lang)}">{escape(text)}</Say><Hangup/></Response>')
    return xml, "application/xml"


# ---- provider REST calls ----

def _vonage_jwt(creds: dict) -> str:
    import jwt  # PyJWT
    now = int(time.time())
    payload = {"application_id": creds["application_id"], "iat": now, "exp": now + 300, "jti": str(uuid.uuid4())}
    key = creds["private_key"].replace("\\n", "\n")
    return jwt.encode(payload, key, algorithm="RS256")


def _twilio_compatible_base(pid: str, creds: dict) -> tuple:
    if pid == "twilio":
        return f"https://api.twilio.com/2010-04-01/Accounts/{creds['account_sid']}", (creds["account_sid"], creds["auth_token"])
    space = re.sub(r"^https?://", "", creds["space_url"]).strip("/")
    return f"https://{space}/api/laml/2010-04-01/Accounts/{creds['project_id']}", (creds["project_id"], creds["api_token"])


async def test_connection(settings: dict) -> dict:
    """Check the saved credentials against the provider's API."""
    pid = settings.get("provider")
    creds = settings.get("credentials", {}).get(pid, {})
    missing = [f["label"] for f in PROVIDERS.get(pid, {}).get("fields", []) if not f.get("optional") and not creds.get(f["key"])]
    if missing:
        return {"ok": False, "message": "Missing: " + ", ".join(missing)}
    if pid == "sip":
        from app.services import sip_dialer
        return await asyncio.to_thread(sip_dialer.test_registration, creds)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if pid in ("twilio", "signalwire"):
                base, auth = _twilio_compatible_base(pid, creds)
                r = await client.get(base + ".json", auth=auth)
            elif pid == "telnyx":
                r = await client.get("https://api.telnyx.com/v2/balance",
                                     headers={"Authorization": f"Bearer {creds['api_key']}"})
            elif pid == "vonage":
                r = await client.get("https://api.nexmo.com/v1/calls", params={"page_size": 1},
                                     headers={"Authorization": f"Bearer {_vonage_jwt(creds)}"})
            else:
                return {"ok": False, "message": f"Unknown provider {pid}"}
        if r.status_code < 300:
            return {"ok": True, "message": f"Connected to {PROVIDERS[pid]['name']}."}
        return {"ok": False, "message": f"{PROVIDERS[pid]['name']} rejected the credentials (HTTP {r.status_code}): {r.text[:200]}"}
    except Exception as e:
        return {"ok": False, "message": f"Could not reach {PROVIDERS[pid]['name']}: {e}"}


async def place_call(settings: dict, to_number: str, call_id: str) -> str:
    """Start an outbound call. The provider then requests
    {public_url}/webhooks/voice/answer?cid=... when the call is answered.
    Returns the provider's call id."""
    missing = missing_settings(settings)
    if missing:
        raise TelephonyError("VoIP is not set up: missing " + ", ".join(missing))
    pid = settings["provider"]
    if pid == "sip":
        from app.services import outbound, sip_dialer
        return sip_dialer.start_call(settings, to_number, call_id, outbound.conversation_factory)
    creds = settings["credentials"][pid]
    base = settings["public_url"]
    answer_url = f"{base}/webhooks/voice/answer?cid={call_id}"
    status_url = f"{base}/webhooks/voice/status?cid={call_id}"
    from_number = settings["from_number"]

    # An extension is not reachable over the phone network: it is called
    # as a SIP address on the PBX (sip:1234@pbx.example.com).
    sip_uri = None
    if is_extension(to_number):
        domain = re.sub(r"^(sips?:|https?://)", "", (settings.get("sip_domain") or "").strip()).strip("/")
        if not domain:
            raise TelephonyError(f"{to_number} is an extension: set the PBX SIP domain in "
                                 "Agent Setup > VoIP & Calling to call extensions")
        sip_uri = f"sip:{to_number}@{domain}"
    dial_to = sip_uri or to_number

    async with httpx.AsyncClient(timeout=20) as client:
        if pid in ("twilio", "signalwire"):
            api, auth = _twilio_compatible_base(pid, creds)
            data = {"To": dial_to, "From": from_number, "Url": answer_url, "Method": "POST",
                    "StatusCallback": status_url, "StatusCallbackMethod": "POST", "Timeout": "30",
                    # a list value is sent as one form field per event
                    "StatusCallbackEvent": ["initiated", "ringing", "answered", "completed"]}
            r = await client.post(api + "/Calls.json", data=data, auth=auth)
            if r.status_code >= 300:
                raise TelephonyError(f"{PROVIDERS[pid]['name']} error {r.status_code}: {r.text[:300]}")
            return r.json().get("sid", "")
        if pid == "telnyx":
            r = await client.post(
                f"https://api.telnyx.com/v2/texml/calls/{creds['texml_app_id']}",
                headers={"Authorization": f"Bearer {creds['api_key']}"},
                json={"To": dial_to, "From": from_number, "Url": answer_url, "UrlMethod": "POST",
                      "StatusCallback": status_url, "StatusCallbackMethod": "POST"},
            )
            if r.status_code >= 300:
                raise TelephonyError(f"Telnyx error {r.status_code}: {r.text[:300]}")
            body = r.json()
            return (body.get("data") or body).get("call_sid") or (body.get("data") or body).get("sid", "")
        if pid == "vonage":
            r = await client.post(
                "https://api.nexmo.com/v1/calls",
                headers={"Authorization": f"Bearer {_vonage_jwt(creds)}"},
                json={"to": [{"type": "sip", "uri": sip_uri} if sip_uri else {"type": "phone", "number": to_number.lstrip("+")}],
                      "from": {"type": "phone", "number": from_number.lstrip("+")},
                      "answer_url": [answer_url], "answer_method": "POST",
                      "event_url": [status_url], "event_method": "POST",
                      "ringing_timer": 30},
            )
            if r.status_code >= 300:
                raise TelephonyError(f"Vonage error {r.status_code}: {r.text[:300]}")
            return r.json().get("uuid", "")
    raise TelephonyError(f"Unknown provider {pid}")


# Provider call statuses -> ours.
STATUS_MAP = {
    "queued": "dialing", "initiated": "dialing", "started": "dialing",
    "ringing": "ringing", "in-progress": "in_progress", "answered": "in_progress",
    "completed": "completed", "busy": "busy", "no-answer": "no_answer", "unanswered": "no_answer",
    "timeout": "no_answer", "failed": "failed", "rejected": "failed", "canceled": "cancelled",
    "cancelled": "cancelled",
}
