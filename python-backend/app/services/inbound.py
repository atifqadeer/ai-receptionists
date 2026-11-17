"""
Inbound calls: the agent answers an extension on your PBX automatically.

The backend registers the inbound extension (e.g. 428) on the PBX like a
desk phone. Every call to that extension is answered at once: the agent
greets the caller with the greeting from Agent Setup, then listens and
answers from the knowledge base (the same AI agent as the chat and the
call simulators) until the caller says goodbye or hangs up.

- registration and audio: sip_dialer.SipPhone (pyVoIP), on its own local
  SIP port, so it runs alongside the outbound SIP account. When the inbound
  extension IS the outbound SIP account (same server and username), that
  one registration places and answers calls.
- speaking and listening: sip_dialer.SipCallSession (barge-in, Whisper)
- the replies: AIAgent.process_message, run on the main event loop
- a log of each call (caller, transcript): data/inbound_calls.json, and a
  recording + event log in data/call_audit/

A watchdog thread keeps the extension registered: it retries every 30
seconds when the PBX is unreachable and re-applies saved settings.
"""

import asyncio
import json
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger

from app.services import telephony
from app.services.sip_dialer import AUDIT_DIR, SipCallSession, SipError, SipPhone, _account, sip_phone, whisper_model

_CALLS_FILE = Path(__file__).resolve().parents[2] / "data" / "inbound_calls.json"
KEEP_CALLS = 1000           # newest inbound calls kept in the log (recordings: sip_dialer.AUDIT_KEEP)
WATCHDOG_SECONDS = 30       # how often the registration is checked
SILENT_TURNS = 3            # caller silent this many times in a row: goodbye

_GOODBYE = re.compile(r"\b(bye|goodbye|good bye|that'?s all|that is all|nothing else|hang up)\b", re.I)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---- call log ----

_store_lock = threading.Lock()


def _load() -> list:
    try:
        if _CALLS_FILE.exists():
            return json.loads(_CALLS_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"Could not read inbound calls: {e}")
    return []


def _save(calls: list) -> None:
    _CALLS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CALLS_FILE.write_text(json.dumps(calls[-KEEP_CALLS:], indent=2, ensure_ascii=False), encoding="utf-8")


def list_calls() -> list:
    with _store_lock:
        return list(reversed(_load()))


def clear_calls() -> None:
    with _store_lock:
        _save([])


def get_call(call_id: str) -> Optional[dict]:
    with _store_lock:
        return next((c for c in _load() if c["id"] == call_id), None)


def delete_call(call_id: str) -> bool:
    with _store_lock:
        calls = _load()
        kept = [c for c in calls if c["id"] != call_id]
        _save(kept)
        return len(kept) != len(calls)


def audit_path(call: dict) -> Optional[Path]:
    """The call's folder in data/call_audit (recording + event log), while it is kept."""
    name = call.get("audit_dir") or ""
    if name and not ("/" in name or "\\" in name or ".." in name) and (AUDIT_DIR / name).is_dir():
        return AUDIT_DIR / name
    # Calls logged before audit_dir was saved: the folder ends with the call id.
    short = re.sub(r"[^0-9a-f]", "", str(call.get("id") or ""))[:8]
    if len(short) == 8 and AUDIT_DIR.is_dir():
        found = sorted(AUDIT_DIR.glob(f"*_{short}"))
        if found:
            return found[-1]
    return None


def call_events(call: dict) -> list:
    path = audit_path(call)
    events = []
    if path and (path / "events.jsonl").exists():
        for line in (path / "events.jsonl").read_text(encoding="utf-8").splitlines():
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
    return events


def recording_file(call: dict) -> Optional[Path]:
    path = audit_path(call)
    return path / "call.wav" if path and (path / "call.wav").exists() else None


def stats(calls: list) -> dict:
    """Totals for the Inbound Calls page."""
    today = datetime.now(timezone.utc).date().isoformat()
    durations = []
    for c in calls:
        if c.get("answered_at") and c.get("ended_at"):
            try:
                durations.append((datetime.fromisoformat(c["ended_at"]) -
                                  datetime.fromisoformat(c["answered_at"])).total_seconds())
            except ValueError:
                pass
    return {
        "total": len(calls),
        "today": sum(1 for c in calls if (c.get("started_at") or "").startswith(today)),
        "completed": sum(1 for c in calls if c.get("status") == "completed"),
        "failed": sum(1 for c in calls if c.get("status") == "failed"),
        "live": sum(1 for c in calls if c.get("status") in ("ringing", "in_progress")),
        "avg_seconds": round(sum(durations) / len(durations)) if durations else 0,
        "unique_callers": len({c.get("caller_number") for c in calls}),
    }


def _add_call(record: dict) -> None:
    with _store_lock:
        calls = _load()
        calls.append(record)
        _save(calls)


def _update_call(call_id: str, **changes) -> None:
    with _store_lock:
        calls = _load()
        for c in calls:
            if c["id"] == call_id:
                c.update(changes)
                break
        _save(calls)


# ---- the inbound line ----

def line_credentials(settings: dict) -> dict:
    """SIP account for the inbound extension. Server and port default to
    the outbound SIP Account's."""
    inbound = telephony.inbound_settings(settings)
    sip = settings.get("credentials", {}).get("sip", {})
    return {
        "server": inbound.get("server") or sip.get("server") or "",
        "port": inbound.get("port") or (sip.get("port") if not inbound.get("server") else "") or "5060",
        "username": str(inbound.get("extension") or ""),
        "password": inbound.get("password") or "",
        "local_port": inbound.get("local_port") or "5064",
    }


class InboundLine:
    def __init__(self):
        # Its own RTP ports, so inbound and outbound calls never collide.
        self.phone = SipPhone(rtp_low=20202, rtp_high=20400, on_call=self._on_call, label="Inbound")
        self.agent = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.active: set = set()
        self.active_lock = threading.Lock()
        self.state = {"state": "disabled", "message": "Inbound calls are turned off."}
        self._poke = threading.Event()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self, agent, loop: asyncio.AbstractEventLoop) -> None:
        self.agent, self.loop = agent, loop
        if self._thread is None:
            self._thread = threading.Thread(target=self._watchdog, daemon=True, name="inbound-line")
            self._thread.start()

    def apply(self) -> None:
        """Re-read the settings now (after they are saved)."""
        self._poke.set()

    def stop(self) -> None:
        self._stop.set()
        self._poke.set()
        self._share_outbound(False)
        self.phone.stop()

    def status(self) -> dict:
        inbound = telephony.inbound_settings(telephony.load_settings())
        with self.active_lock:
            active = len(self.active)
        return {**self.state, "enabled": bool(inbound.get("enabled")),
                "extension": inbound.get("extension") or "", "active_calls": active}

    def _share_outbound(self, on: bool) -> None:
        """Answer (or stop answering) calls on the outbound SIP Account's
        own registration."""
        sip_phone.on_call = self._on_call if on else None
        if sip_phone.phone is not None:
            sip_phone.phone.callCallback = sip_phone.on_call

    @staticmethod
    def _same_as_outbound(settings: dict, creds: dict) -> bool:
        """The inbound extension is the outbound SIP Account itself (e.g.
        both 428): registering it twice would make the two fight, so the
        one registration places and answers calls."""
        sip = settings.get("credentials", {}).get("sip", {})
        if settings.get("provider") != "sip" or not sip.get("server") or not creds["server"]:
            return False
        a, b = _account(sip), _account(creds)
        return a[:3] == b[:3]   # server, port, username

    def _watchdog(self) -> None:
        last_key = None
        while not self._stop.is_set():
            poked = self._poke.is_set()
            self._poke.clear()
            try:
                settings = telephony.load_settings()
                inbound = telephony.inbound_settings(settings)
                creds = line_credentials(settings)
                key = _account(creds) if creds["server"] else None
                shared = bool(inbound.get("enabled")) and bool(creds["username"]) and self._same_as_outbound(settings, creds)
                self._share_outbound(shared)
                if shared:
                    if self.phone.phone is not None:
                        self.phone.stop()
                    sip = settings["credentials"]["sip"]
                    try:
                        sip_phone.ensure(sip)
                        self._share_outbound(True)
                        server, port = _account(sip)[:2]
                        self.state = {"state": "registered",
                                      "message": f"Extension {creds['username']} (the SIP Account above) is registered on "
                                                 f"{server}:{port}. Calls to it are answered by the agent; "
                                                 "it also places the outbound job calls."}
                    except SipError as e:
                        self.state = {"state": "error", "message": f"{e} Retrying every {WATCHDOG_SECONDS} seconds."}
                        logger.warning(f"Inbound: {e}")
                elif not inbound.get("enabled"):
                    if self.phone.phone is not None:
                        self.phone.stop()
                        logger.info("Inbound: extension unregistered (turned off)")
                    self.state = {"state": "disabled", "message": "Inbound calls are turned off."}
                elif not (creds["server"] and creds["username"] and creds["password"]):
                    self.phone.stop()
                    self.state = {"state": "error", "message": "Enter the extension, its password and the SIP server "
                                                               "(or set the server on the SIP Account above)."}
                elif self._clashes_with_outbound(settings, creds):
                    self.phone.stop()
                    self.state = {"state": "error", "message": "The inbound line needs a different 'Local SIP port' "
                                                               "from the outbound SIP Account (e.g. 5064)."}
                elif poked or key != last_key or not self.phone.registered():
                    try:
                        self.phone.ensure(creds)
                        self.state = {"state": "registered",
                                      "message": f"Extension {creds['username']} is registered on "
                                                 f"{key[0]}:{key[1]}. Calls to it are answered by the agent."}
                    except SipError as e:
                        self.state = {"state": "error", "message": f"{e} Retrying every {WATCHDOG_SECONDS} seconds."}
                        logger.warning(f"Inbound: {e}")
                last_key = key
            except Exception as e:
                self.state = {"state": "error", "message": f"Inbound line error: {e}"}
                logger.warning(f"Inbound line error: {e}")
            self._poke.wait(WATCHDOG_SECONDS)

    @staticmethod
    def _clashes_with_outbound(settings: dict, creds: dict) -> bool:
        sip = settings.get("credentials", {}).get("sip", {})
        if settings.get("provider") != "sip" or not sip.get("server"):
            return False
        return str(sip.get("local_port") or 5062) == str(creds["local_port"] or 5064)

    def _on_call(self, call) -> None:
        """pyVoIP runs this in its own thread for each incoming call."""
        settings = telephony.load_settings()
        inbound = telephony.inbound_settings(settings)
        caller = call.request.headers.get("From") or {}
        number = caller.get("number") or caller.get("address") or "unknown"
        with self.active_lock:
            busy = len(self.active) >= max(1, int(inbound.get("max_concurrent") or 2))
            if not busy:
                self.active.add(call.call_id)
        if busy or self.agent is None or self.loop is None:
            logger.info(f"Inbound: call from {number} refused (line busy)")
            try:
                call.deny()
            except Exception:
                pass
            return
        try:
            InboundCallSession(settings, call, self.loop, self.agent).run()
        finally:
            with self.active_lock:
                self.active.discard(call.call_id)


class InboundCallSession(SipCallSession):
    """Answer, greet, then listen and reply until the call ends."""

    AUDIT_FIRST_EVENT = "incoming"

    def __init__(self, settings: dict, call, loop: asyncio.AbstractEventLoop, agent):
        caller = call.request.headers.get("From") or {}
        self.caller_number = caller.get("number") or caller.get("address") or "unknown"
        # pyVoIP leaves a quote on display names: '"Atif Developer" <sip:..>' -> 'Atif Developer"'
        self.caller_name = (caller.get("caller") or "").strip().strip("\"'").strip()
        super().__init__(settings, self.caller_number, uuid.uuid4().hex, loop, make_conversation=None)
        self.call = call
        self.agent = agent
        self.inbound = telephony.inbound_settings(settings)
        self.conv_id = f"inbound-{self.call_id[:12]}"

    def _ask(self, text: str) -> str:
        """The agent's reply to the caller (run on the main event loop)."""
        future = asyncio.run_coroutine_threadsafe(self.agent.process_message(self.conv_id, text), self.loop)
        return (future.result(timeout=60).message or "").strip()

    def run(self) -> None:
        cfg = self.agent.get_config()
        greeting = (self.inbound.get("greeting") or cfg.greeting or "Hello, how can I help you?").strip()
        farewell = (cfg.farewell or "Thank you for calling. Goodbye.").strip()
        transcript: list = []
        record = {"id": self.call_id, "caller_number": self.caller_number, "caller_name": self.caller_name,
                  "extension": self.inbound.get("extension"), "status": "ringing", "started_at": _now(),
                  "answered_at": None, "ended_at": None, "transcript": transcript, "error": None,
                  "audit_dir": self.audit.dir.name}
        _add_call(record)
        logger.info(f"Inbound: call from {self.caller_number} {self.caller_name!r}")
        final = "failed"
        try:
            whisper_model()
            self.call.answer()
            self.audit.answered()
            self.clock = time.time()
            _update_call(self.call_id, status="in_progress", answered_at=_now())
            self.whisper_prompt = (f"A caller phones {cfg.company_name} and asks the receptionist about the company, "
                                   "its services, prices, opening hours, appointments and jobs.")
            # The agent knows it has already greeted the caller.
            self.agent.conversation_history[self.conv_id] = [
                {"role": "system", "content": self.agent._build_system_prompt()},
                {"role": "assistant", "content": greeting},
            ]
            deadline = time.time() + 60 * max(1, int(self.inbound.get("max_minutes") or 15))

            def turn(text: str, end: bool = False):
                transcript.append({"role": "agent", "text": text})
                _update_call(self.call_id, transcript=transcript)
                barge = self.say(text, interruptible=not end)
                if barge:
                    transcript[-1]["interrupted"] = True
                return barge

            barge = turn(greeting)
            silent, unclear = 0, 0
            while self._answered():
                heard = self.listen(barge)
                barge = None
                if not self._answered():
                    break
                if not heard:
                    silent += 1
                    if silent >= SILENT_TURNS:
                        turn("I can't hear anything, so I'll end the call now. " + farewell, end=True)
                        break
                    barge = turn("Are you still there? How can I help you?" if silent == 1 else
                                 "Sorry, I can't hear you. Could you speak a little louder?")
                    continue
                silent = 0
                if self.unclear and unclear < 2:
                    unclear += 1
                    transcript.append({"role": "caller", "text": heard, "unclear": True})
                    barge = turn("Sorry, I didn't quite catch that. Could you say it again?")
                    continue
                unclear = 0
                transcript.append({"role": "caller", "text": heard})
                if _GOODBYE.search(heard):
                    turn(farewell, end=True)
                    break
                if time.time() > deadline:
                    turn("I'm afraid we've reached the time limit for this call. " + farewell, end=True)
                    break
                reply = self._ask(heard) or "Sorry, could you say that again?"
                end = reply.lower() == farewell.lower()
                barge = turn(reply, end=end)
                if end:
                    break
            final = "completed"
        except Exception as e:
            logger.warning(f"Inbound call {self.call_id[:8]} failed: {e}")
            self.audit.event("error", error=str(e))
            _update_call(self.call_id, error=str(e))
        finally:
            if self._answered():
                try:
                    time.sleep(0.5)
                    self.we_hung_up = True
                    self.call.hangup()
                except Exception:
                    pass
            self.audit.event("call_ended", by="agent" if self.we_hung_up else "caller", result=final)
            self.audit.save()
            try:
                self.agent.end_call(self.conv_id)
            except Exception:
                pass
            _update_call(self.call_id, status=final, ended_at=_now(), transcript=transcript,
                         ended_by="agent" if self.we_hung_up else "caller")
            logger.info(f"Inbound: call from {self.caller_number} ended ({final})")


inbound_line = InboundLine()
