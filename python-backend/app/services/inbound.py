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
- a log of each call (caller, transcript): MySQL (calls "inbound_calls"), and a
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

from app.core import store
from app.services import call_rules
from app.services import telephony
from app.services import call_intents, dnc
from app.services.sip_dialer import (AUDIT_DIR, RING_TIMEOUT, SipCallSession, SipError, SipPhone, _account,
                                      cancel_invite, dial_target, sip_phone, whisper_model)

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
        return store.load_list("inbound_calls")
    except Exception as e:
        logger.warning(f"Could not read inbound calls: {e}")
    return []


def _save(calls: list) -> None:
    store.save_list("inbound_calls", calls[-KEEP_CALLS:])


def list_calls(direction: str = "inbound") -> list:
    """Newest first. direction: "inbound" (answered on the extension) or
    "outbound" (dialled from the Make a Call dial pad)."""
    with _store_lock:
        return [c for c in reversed(_load()) if c.get("direction", "inbound") == direction]


def clear_calls(direction: str = "inbound") -> None:
    with _store_lock:
        _save([c for c in _load() if c.get("direction", "inbound") != direction])


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
        # A call that ended with a decision (DNC, not interested, ...) was still answered and completed.
        "completed": sum(1 for c in calls if c.get("status") in ("completed", "dnc", "not_interested", "wrong_number",
                                                                  "callback", "voicemail", "hung_up", "dropped")),
        "hung_up": sum(1 for c in calls if c.get("status") == "hung_up"),
        "dnc": sum(1 for c in calls if c.get("status") == "dnc"),
        "not_interested": sum(1 for c in calls if c.get("status") == "not_interested"),
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


def close_interrupted_calls() -> None:
    """At startup: calls still marked live were cut off when the backend
    stopped (restart, reload, crash). Mark them failed instead of leaving
    them "dialing" or "in progress" for ever."""
    with _store_lock:
        calls = _load()
        changed = 0
        for c in calls:
            if c.get("status") in ("dialing", "ringing", "in_progress"):
                c.update(status="failed", ended_at=c.get("ended_at") or _now(),
                         error="The backend stopped or restarted during this call.")
                changed += 1
        if changed:
            _save(calls)
            logger.info(f"Calls: marked {changed} call(s) interrupted by a backend restart as failed")


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
        close_interrupted_calls()
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
        fails = 0   # registrations refused in a row: retry less often each time
        while not self._stop.is_set():
            poked = self._poke.is_set()
            self._poke.clear()
            if poked:
                fails = 0
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
                        self.state = {"state": "error", "message": f"{e} Retrying in {self._retry_wait(fails + 1)} seconds."}
                        fails += 1
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
                        self.state = {"state": "error", "message": f"{e} Retrying in {self._retry_wait(fails + 1)} seconds."}
                        fails += 1
                        logger.warning(f"Inbound: {e}")
                last_key = key
            except Exception as e:
                self.state = {"state": "error", "message": f"Inbound line error: {e}"}
                logger.warning(f"Inbound line error: {e}")
            if self.state.get("state") != "error":
                fails = 0
            self._poke.wait(self._retry_wait(fails))

    @staticmethod
    def _retry_wait(fails: int) -> int:
        """Seconds until the next check. A PBX that refuses registrations is
        often rate-limiting us (FreePBX Responsive Firewall, fail2ban):
        retrying every 30 s keeps the block alive, so back off to 5 min."""
        return WATCHDOG_SECONDS if fails <= 1 else min(300, WATCHDOG_SECONDS * 2 ** (fails - 1))

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

    DIRECTION = "inbound"
    hangup_requested = False

    def __init__(self, settings: dict, call, loop: asyncio.AbstractEventLoop, agent,
                 number: str = "", name: str = ""):
        if call is not None:
            caller = call.request.headers.get("From") or {}
            number = caller.get("number") or caller.get("address") or "unknown"
            # pyVoIP leaves a quote on display names: '"Atif Developer" <sip:..>' -> 'Atif Developer"'
            name = caller.get("caller") or ""
        self.caller_number = number
        self.caller_name = (name or "").strip().strip("\"'").strip()
        super().__init__(settings, self.caller_number, uuid.uuid4().hex, loop, make_conversation=None)
        self.call = call
        self.agent = agent
        self.inbound = telephony.inbound_settings(settings)
        self.conv_id = f"{'dialed' if self.DIRECTION == 'outbound' else 'inbound'}-{self.call_id[:12]}"

    def _greeting(self, cfg) -> str:
        return (self.inbound.get("greeting") or cfg.greeting or "Hello, how can I help you?").strip()

    # What the agent says when the caller decides (see call_intents).
    DECISION_LINES = {
        "do_not_call": ("I completely understand, and I'm sorry for disturbing you. I've added your number to our "
                        "do-not-call list, so you won't be called again. Goodbye."),
        "not_interested": "No problem at all, thank you for letting me know. Have a great day. Goodbye.",
        "end_call": "Of course. Thank you for your time. Goodbye.",
        "wrong_number": "I'm so sorry about that, I must have the wrong number. Have a good day. Goodbye.",
        "abusive": "I'm sorry you feel that way. I'll end the call here. Goodbye.",
        "voicemail": "",
        "callback": "",
    }
    # Inbound: the caller rang us, so only these end the call (and "not
    # interested" only on its own: "I'm not interested in X, I want Y" is a request).
    DECISIONS = ("do_not_call", "abusive", "wrong_number", "not_interested", "end_call")
    STANDALONE_WORDS = 8

    def _decision(self, heard: str, turn_no: int, greeting: str) -> "tuple | None":
        """(outcome, what to say) when the caller has decided, else None."""
        decision = call_intents.detect(heard, allow_voicemail=self.DIRECTION == "outbound" and turn_no <= 2)
        if decision is None and turn_no == 1 and self.DIRECTION == "outbound" and call_intents.is_bare_no(heard) \
                and re.search(r"\b(interested|looking)\b", greeting.lower()):
            decision = "not_interested"      # "no" to "are you looking for a new role?"
        if decision not in self.DECISIONS:
            return None
        if decision in ("not_interested", "wrong_number") and self.DIRECTION == "inbound" \
                and len(heard.split()) > self.STANDALONE_WORDS:
            return None
        said = self.DECISION_LINES.get(decision, "")
        if decision == "voicemail":
            cfg = self.agent.get_config()
            said = (f"Hello, this is {cfg.agent_name} from {cfg.company_name}. Sorry we missed you; "
                    f"we'll try you again later. Goodbye.")
        if decision == "callback":
            when = call_intents.callback_when(heard)
            said = (f"No problem at all. We'll call you back {when}. Goodbye." if when else
                    "No problem at all. We'll call you back at a better time. Goodbye.")
        return decision, said

    def _farewell(self, cfg) -> str:
        return (cfg.farewell or "Thank you for calling. Goodbye.").strip()

    def _adapt(self, reply: str) -> str:
        """Hook: reword a reply for this kind of call (inbound: as is)."""
        return reply

    def _ask(self, text: str) -> str:
        """The agent's reply to the caller (run on the main event loop)."""
        future = asyncio.run_coroutine_threadsafe(self.agent.process_message(self.conv_id, text), self.loop)
        return (future.result(timeout=60).message or "").strip()

    def _connect(self) -> bool:
        """Inbound: answer the ringing call. Returns True once connected."""
        self.call.answer()
        return True

    def run(self) -> None:
        cfg = self.agent.get_config()
        greeting = self._greeting(cfg)
        farewell = self._farewell(cfg)
        transcript: list = []
        outgoing = self.DIRECTION == "outbound"
        record = {"id": self.call_id, "direction": self.DIRECTION, "caller_number": self.caller_number,
                  "caller_name": self.caller_name, "extension": self.inbound.get("extension"),
                  "status": "dialing" if outgoing else "ringing", "started_at": _now(),
                  "answered_at": None, "ended_at": None, "transcript": transcript, "error": None,
                  "audit_dir": self.audit.dir.name}
        _add_call(record)
        _live[self.call_id] = self
        logger.info(f"{self.DIRECTION.title()}: call {'to' if outgoing else 'from'} {self.caller_number} {self.caller_name!r}")
        final = "failed"
        try:
            whisper_model()
            if not self._connect():
                final = "no_answer"
                return
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
                if end:
                    self.ending = True
                if not self._answered():
                    return None
                transcript.append({"role": "agent", "text": text})
                _update_call(self.call_id, transcript=transcript)
                barge = self.say(text, interruptible=not end)
                if barge:
                    transcript[-1]["interrupted"] = True
                return barge

            barge = turn(greeting)
            silent, unclear, turn_no = 0, 0, 0
            while self._answered() and not self.hangup_requested:
                heard = self.listen(barge)
                barge = None
                if not self._answered() or self.hangup_requested:
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
                turn_no += 1
                transcript.append({"role": "caller", "text": heard})
                decided = self._decision(heard, turn_no, greeting)
                if decided:
                    outcome, said = decided
                    self.outcome = outcome
                    extra = {"callback_when": call_intents.callback_when(heard)} if outcome == "callback" else {}
                    _update_call(self.call_id, outcome=outcome, outcome_said=heard, **extra)
                    self.audit.event("decision", outcome=outcome, heard=heard)
                    logger.info(f"{self.DIRECTION.title()} call {self.call_id[:8]}: {outcome} ({heard!r})")
                    if outcome == "do_not_call":
                        try:
                            dnc.add(self.caller_number, "dial pad" if self.DIRECTION == "outbound" else "inbound call",
                                    heard, self.call_id, self.caller_name)
                        except ValueError:
                            pass   # no caller number (anonymous)
                    if said:
                        turn(said, end=True)
                    break
                if _GOODBYE.search(heard):
                    turn(farewell, end=True)
                    break
                if time.time() > deadline:
                    turn("I'm afraid we've reached the time limit for this call. " + farewell, end=True)
                    break
                if not self._answered() or self.hangup_requested:
                    break
                reply = self._ask(heard) or "Sorry, could you say that again?"
                if not self._answered() or self.hangup_requested:
                    break
                end = reply.lower() == (cfg.farewell or "").strip().lower() or reply.lower() == farewell.lower() \
                    or bool(re.search(r"\b(goodbye|have a (wonderful|great|nice|good) day)\W*$", reply, re.I))
                reply = self._adapt(reply)
                barge = turn(reply, end=end)
                if end:
                    break
            final = "completed"
        except Exception as e:
            logger.warning(f"{self.DIRECTION.title()} call {self.call_id[:8]} failed: {e}")
            self.audit.event("error", error=str(e))
            _update_call(self.call_id, error=str(e))
        finally:
            _live.pop(self.call_id, None)
            if self._answered():
                try:
                    time.sleep(0.5)
                    self.we_hung_up = True
                    self.call.hangup()
                except Exception:
                    pass
            if self.hangup_requested:
                self.we_hung_up = True
                if final == "no_answer":
                    final = "cancelled"
            if self.call is not None and self.audit.inbound:
                quality = self.line_quality()
                self.audit.event("line_quality", **quality)
                if quality.get("missing_audio_pct", 0) > 5:
                    logger.warning(f"Call {self.call_id[:8]}: poor line, {quality['missing_audio_pct']}% of the "
                                   "caller's audio was lost on the way (network packet loss)")
            bye_at = getattr(self.call, "bye_at", None)
            if bye_at:
                self.audit.event("bye_received", stopped_after_seconds=round(time.time() - bye_at, 2))
            self.audit.event("call_ended", by="agent" if self.we_hung_up else "caller", result=final)
            self.audit.save()
            try:
                self.agent.end_call(self.conv_id)
            except Exception:
                pass
            outcome = getattr(self, "outcome", None)
            if final == "completed" and outcome:
                final = "voicemail" if outcome == "voicemail" else call_intents.STATUS_FOR.get(outcome, final)
            elif final == "completed" and not self.we_hung_up and not self.ending and not self.hangup_requested:
                final = "hung_up"          # the other person put the phone down mid-conversation
                self.audit.event("hung_up", by="caller")
            call_rules.after_call(self.caller_number, final, self.call_id, self.caller_name)
            _update_call(self.call_id, status=final, ended_at=_now(), transcript=transcript,
                         ended_by="agent" if self.we_hung_up else "caller")
            logger.info(f"{self.DIRECTION.title()}: call with {self.caller_number} ended ({final})")

    def request_hangup(self) -> None:
        """The dashboard's Hang up button: stop ringing or end the conversation."""
        from pyVoIP.VoIP import CallState
        self.hangup_requested = True
        call = self.call
        if call is None:
            self.audit.event("hangup_pressed", while_state="placing the call")
            return
        try:
            if call.state == CallState.ANSWERED:
                self.audit.event("hangup_pressed", while_state="connected")
                call.hangup()                 # BYE
            elif call.state in (CallState.DIALING, CallState.RINGING):
                if self.DIRECTION == "outbound":
                    self.audit.event("hangup_pressed", while_state=str(call.state))
                    cancel_invite(call, on_result=lambda r: self.audit.event("cancel_result", result=r))
                else:
                    call.deny()
        except Exception as e:
            logger.warning(f"Call {self.call_id[:8]}: hang up failed: {e}")
            self.audit.event("hangup_failed", error=str(e), state=str(call.state))


class DialedCallSession(InboundCallSession):
    """The Make a Call dial pad: the agent phones a number over the SIP
    Account and holds the same receptionist conversation as an inbound call."""

    DIRECTION = "outbound"
    AUDIT_FIRST_EVENT = "dialing"

    def __init__(self, settings: dict, number: str, name: str, loop: asyncio.AbstractEventLoop, agent,
                 opening: str = ""):
        super().__init__(settings, None, loop, agent, number=number, name=name)
        self.dial = dial_target(number, settings)
        self.opening = (opening or "").strip()

    def _greeting(self, cfg) -> str:
        """We are phoning them: say who is calling and why, then ask a
        question they can answer (not "how can I help you?")."""
        first = (self.caller_name.split() or [""])[0]
        text = self.opening or DEFAULT_DIAL_OPENING
        out = (text.replace("{name}", first).replace("{agent}", cfg.agent_name or "the assistant")
                   .replace("{company}", cfg.company_name or "our company"))
        # "Hello , this is" when no name was entered
        return re.sub(r"\s+([,.!?])", r"\1", re.sub(r"\s{2,}", " ", out)).strip()

    def _farewell(self, cfg) -> str:
        return f"Thank you for your time. Have a great day. Goodbye."

    DECISIONS = ("do_not_call", "abusive", "wrong_number", "not_interested", "end_call", "voicemail", "callback")

    def _adapt(self, reply: str) -> str:
        # The receptionist's lines are written for people who rang us.
        reply = re.sub(r"\b(thank you|thanks) (so much )?for calling( [A-Z][\w&' ]*?)?([.!,])", r"Thank you for your time\4", reply, flags=re.I)
        return re.sub(r"\bfor calling\b", "for your time", reply, flags=re.I)

    def _connect(self) -> bool:
        from pyVoIP.VoIP import CallState
        phone = sip_phone.ensure(self.settings["credentials"]["sip"])
        self.call = phone.call(self.dial)
        _update_call(self.call_id, status="ringing")
        self.audit.event("ringing", dial=self.dial)
        deadline = time.time() + RING_TIMEOUT
        while self.call.state == CallState.DIALING and time.time() < deadline and not self.hangup_requested:
            time.sleep(0.2)
        if self.call.state == CallState.DIALING:
            # Nobody answered in time: stop it ringing at the other end.
            try:
                cancel_invite(self.call, on_result=lambda r: self.audit.event("cancel_result", result=r))
            except Exception as e:
                logger.warning(f"Dial {self.call_id[:8]}: could not cancel the ringing call: {e}")
            if not self.hangup_requested:
                self.call.sip_reason = "No answer"
        if self.call.state == CallState.ANSWERED and self.hangup_requested:
            # Answered just as Hang up was pressed: end it straight away.
            try:
                self.call.hangup()
            except Exception:
                pass
        if self.call.state != CallState.ANSWERED or self.hangup_requested:
            reason = getattr(self.call, "sip_reason", "") or ""
            self.audit.event("not_answered", state=str(self.call.state), reason=reason)
            if reason and reason != "Cancelled":
                _update_call(self.call_id, reason=reason)
            return False
        return True


_live: dict = {}   # call id -> session, while the call is going on


DEFAULT_DIAL_OPENING = ("Hello {name}, this is {agent} calling from {company}. I'm an AI assistant, and I'm "
                        "calling about job opportunities with us. Are you currently looking for a new role?")


def dial(number: str, name: str, agent, loop: asyncio.AbstractEventLoop, opening: str = "") -> str:
    """Place a call from the dial pad in the background; returns its id."""
    settings = telephony.load_settings()
    if settings.get("provider") != "sip":
        raise SipError("The dial pad calls through the SIP / VoIP Account: choose SIP as the provider in Agent Setup.")
    missing = telephony.missing_settings(settings)
    if missing:
        raise SipError("The SIP Account is not set up yet: missing " + ", ".join(missing))
    listed = dnc.get(number)
    if listed:
        raise SipError(f"{number} is on the Do Not Call list (they asked not to be called on "
                       f"{(listed.get('added_at') or '')[:10]}). Remove it from the list first if they have agreed to be called.")
    blocked = call_rules.check(number)
    if blocked:
        raise SipError(blocked[1] + " (Settings › GuardRails › Call Rules)")
    call_rules.note_call(number)
    session = DialedCallSession(settings, number, name, loop, agent, opening=opening)
    threading.Thread(target=session.run, daemon=True, name=f"dial-{session.call_id[:8]}").start()
    return session.call_id


def hangup(call_id: str) -> bool:
    session = _live.get(call_id)
    if not session:
        return False
    session.request_hangup()
    return True


inbound_line = InboundLine()
