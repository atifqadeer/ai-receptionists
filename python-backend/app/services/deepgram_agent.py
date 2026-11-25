"""
Phone calls on the Deepgram Voice Agent API (the "Deepgram" card in
Settings > Calling > Call Voice).

One websocket to Deepgram carries the whole conversation: the caller's
audio goes up, Deepgram hears it (Nova-3), an LLM that Deepgram runs and
bills thinks of the answer, and the answer comes back as speech (Aura-2),
8 kHz u-law, the phone line's own format. Deepgram also notices when the
caller talks over the agent (barge-in): the agent's queued audio is then
dropped at once.

What stays on this PC:
- the agent's instructions and knowledge (Agent Setup), sent as the prompt
- client-side functions the LLM calls: end_call (with the outcome:
  interested, not interested, call back, do not call, ...) and
  lookup_company_info (the knowledge base search)
- the guardrails: every caller sentence still goes through call_intents
  (do not call, wrong number, ...), so the outcome, the Do Not Call list
  and Call Rules work exactly as on the Standard card
- the transcript, the call audit and the call lists

The sip_dialer call sessions call converse() once the call is answered;
when Deepgram can't be reached (no key, rejected key, no internet), it
returns "unavailable" before anything is said and the call carries on the
Standard way, and "dropped" when the connection broke mid-call.
"""

import json
import threading
import time
from typing import Callable, Optional

from loguru import logger

from app.services import voice

AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse"
CONNECT_TIMEOUT = 8.0       # seconds to connect and have the settings accepted
PLAY_AHEAD = 0.3            # seconds of agent audio queued on the line ahead of time
END_GRACE = 12.0            # longest wait for the goodbye after the call is to end
IDLE_PROMPT = 20.0          # seconds of silence before "are you still there?"
IDLE_END = 15.0             # ...and after that, before the agent hangs up
PROMPT_MAX = 24000          # characters of instructions sent to the LLM

OUTCOMES = {
    "interested": "they want to go ahead / are interested",
    "not_interested": "they are not interested",
    "callback": "they asked to be called back later",
    "do_not_call": "they asked never to be called again / to be removed from the list",
    "wrong_number": "wrong person or wrong number",
    "voicemail": "an answering machine or voicemail answered",
    "abusive": "the caller was abusive",
    "end_call": "they want to end the call / have to go",
    "completed": "the conversation simply finished (questions answered, nothing else to do)",
}

CALL_RULES = """

PHONE CALL RULES (this is a live phone call, everything you write is spoken aloud):
- Speak naturally in short sentences, one or two at a time. No lists, markdown, emojis or URLs.
- Say numbers, prices and times the way a person says them.
- If you did not understand the caller, politely ask them to repeat.
- People often say "hello?" as they pick up, while your opening is still playing; they still hear the whole
  opening. Don't repeat the opening or ask if they can hear you: reply with at most a few words, such as
  "Hi there!", and let them answer the opening's question.
- For company facts you are unsure of, call lookup_company_info first. Never invent facts.
- When the conversation is over (the caller says goodbye, has decided, asks you to stop, or it is a voicemail),
  call end_call with the outcome, then say one short polite goodbye. Do not keep talking after that.
- If they ask not to be called again, apologise, confirm they will not be called again, and call end_call
  with outcome do_not_call.
- If they ask for a meeting, appointment or interview: ask what day and time suits them, call request_meeting,
  then tell them the recruitment team will contact them to confirm it. Never say it is booked.
- If they ask to be called back later: ask when (if they didn't say), then call end_call with outcome callback
  and callback_when.
"""


def enabled() -> bool:
    return voice.agent_active()


def _functions() -> list:
    return [
        {"name": "end_call",
         "description": "End the phone call. Call it when the conversation is over, with what was decided. "
                        "After it returns, say one short goodbye.",
         "parameters": {"type": "object", "properties": {
             "outcome": {"type": "string", "enum": list(OUTCOMES),
                         "description": "; ".join(f"{k}: {v}" for k, v in OUTCOMES.items())},
             "callback_when": {"type": "string", "description": "for callback: when they asked to be called, in their words"},
             "reason": {"type": "string", "description": "a few words on why"}},
             "required": ["outcome"]}},
        {"name": "request_meeting",
         "description": "Pass a request for a meeting, appointment or interview with the recruitment team to the team. "
                        "Ask what day and time suits them first. The team confirms it with them later; you cannot "
                        "book it yourself.",
         "parameters": {"type": "object", "properties": {
             "when": {"type": "string", "description": "the day and time they asked for, in their words"},
             "notes": {"type": "string", "description": "what the meeting is about, in a few words"}},
             "required": ["when"]}},
        {"name": "lookup_company_info",
         "description": "Search the company's knowledge base (services, prices, hours, address, policies, roles) "
                        "for the caller's question. Returns the passage found, or nothing.",
         "parameters": {"type": "object", "properties": {
             "question": {"type": "string", "description": "the caller's question"}},
             "required": ["question"]}},
    ]


def settings_message(prompt: str, greeting: str, s: Optional[dict] = None) -> dict:
    s = s or voice.get_settings(fresh=True)
    dg = s["deepgram"]
    provider = dg.get("agent_llm_provider") or "open_ai"
    think = {"provider": {"type": provider, "model": dg.get("agent_llm_model") or "gpt-4o-mini"},
             "prompt": prompt[:PROMPT_MAX - len(CALL_RULES)] + CALL_RULES,
             "functions": _functions()}
    try:
        think["provider"]["temperature"] = max(0.0, min(1.0, float(dg.get("agent_temperature") or 0.5)))
    except ValueError:
        pass
    agent = {"language": (s.get("language") or "en")[:5],
             "listen": {"provider": {"type": "deepgram", "model": dg.get("stt_model") or "nova-3"}},
             "think": think,
             "speak": {"provider": {"type": "deepgram", "model": dg.get("tts_voice") or "aura-2-thalia-en"}}}
    if greeting:
        agent["greeting"] = greeting
    return {"type": "Settings",
            "audio": {"input": {"encoding": "linear16", "sample_rate": 8000},
                      "output": {"encoding": "mulaw", "sample_rate": 8000, "container": "none"}},
            "agent": agent}


def _connect(key: str):
    from websockets.sync.client import connect
    return connect(AGENT_URL, additional_headers={"Authorization": f"Token {key}"},
                   open_timeout=CONNECT_TIMEOUT, close_timeout=2, max_size=None)


def test() -> dict:
    """Connect, send the settings and wait for Deepgram to accept them."""
    s = voice.get_settings(fresh=True)
    key = voice.api_key("deepgram", s)
    if not key:
        return {"ok": False, "message": "Add a Deepgram API key first."}
    t = time.time()
    try:
        ws = _connect(key)
    except Exception as e:
        return {"ok": False, "message": _connect_error(e, key)}
    try:
        ws.send(json.dumps(settings_message("You are a helpful receptionist.", "", s)))
        deadline = time.time() + CONNECT_TIMEOUT
        while time.time() < deadline:
            msg = ws.recv(timeout=max(0.1, deadline - time.time()))
            if isinstance(msg, bytes):
                continue
            data = json.loads(msg)
            if data.get("type") == "SettingsApplied":
                dg = s["deepgram"]
                return {"ok": True, "message": f"Deepgram Voice Agent is ready ({dg.get('agent_llm_model')} via "
                                               f"{dg.get('agent_llm_provider')}, voice {dg.get('tts_voice')}) "
                                               f"in {time.time() - t:.1f}s."}
            if data.get("type") == "Error":
                return {"ok": False, "message": f"Deepgram refused the settings: {data.get('description') or data}"}
        return {"ok": False, "message": "Deepgram did not answer in time."}
    except Exception as e:
        return {"ok": False, "message": f"Deepgram Voice Agent failed: {e}"}
    finally:
        try:
            ws.close()
        except Exception:
            pass


def _connect_error(e: Exception, key: str) -> str:
    text = str(e)
    if "401" in text or "403" in text:
        voice.mark_rejected("deepgram", key)
        return "Deepgram rejected the API key."
    return f"Could not reach the Deepgram Voice Agent: {text[:200]}"


class Link:
    """The websocket to the Deepgram Voice Agent, opened while the phone
    rings so the greeting is ready the moment the call is answered (before
    this, the caller waited 1.5-3 s in silence, said "hello?", and that
    "hello" cut the greeting off).

    Audio Deepgram sends is kept in `out` until converse() plays it; other
    messages wait in `pending` until converse() takes them over."""

    KEEPALIVE = 4.0

    def __init__(self, call_id: str, audit, prompt: str, greeting: str):
        self.call_id, self.audit = call_id, audit
        self.prompt, self.greeting = prompt, greeting
        self.lock = threading.Lock()
        self.out = bytearray()             # agent audio not yet on the line
        self.pending: list = []            # messages before converse() takes over
        self.handler: Optional[Callable[[dict], None]] = None
        self.ready = threading.Event()     # settings accepted, or failed
        self.failed = ""
        self.closed = False
        self.ws = None
        self.settings = voice.get_settings(fresh=True)
        self.started = time.time()

    @classmethod
    def open(cls, call_id: str, audit, prompt: str, greeting: str) -> "Link":
        """Start connecting in the background; returns at once."""
        link = cls(call_id, audit, prompt, greeting)
        threading.Thread(target=link._run, daemon=True, name=f"dg-agent-{call_id[:8]}").start()
        return link

    def send_json(self, data: dict) -> None:
        try:
            if self.ws is not None:
                self.ws.send(json.dumps(data))
        except Exception:
            pass

    def send_audio(self, pcm16: bytes) -> None:
        try:
            if self.ws is not None:
                self.ws.send(pcm16)
        except Exception:
            pass

    def close(self) -> None:
        self.closed = True
        try:
            if self.ws is not None:
                self.ws.close()
        except Exception:
            pass

    def bind(self, handler: Callable[[dict], None]) -> None:
        """converse() takes over: the messages so far, then every new one."""
        with self.lock:
            waiting, self.pending = self.pending, []
            self.handler = handler
        for data in waiting:
            self._dispatch(handler, data)

    def _dispatch(self, handler, data: dict) -> None:
        try:
            handler(data)
        except Exception as e:     # one bad message must not end the call
            logger.warning(f"Call {self.call_id[:8]}: Voice Agent message not handled: {e}")

    def _keepalive(self) -> None:
        # Until the call is answered no audio is sent: keep the connection open.
        while not self.closed and self.handler is None:
            time.sleep(self.KEEPALIVE)
            if self.handler is None and not self.closed:
                self.send_json({"type": "KeepAlive"})

    def _run(self) -> None:
        key = voice.api_key("deepgram", self.settings)
        try:
            self.ws = _connect(key)
            self.ws.send(json.dumps(settings_message(self.prompt, self.greeting, self.settings)))
        except Exception as e:
            self.failed = _connect_error(e, key)
            self.closed = True
            self.ready.set()
            return
        threading.Thread(target=self._keepalive, daemon=True, name=f"dg-keepalive-{self.call_id[:8]}").start()
        try:
            while True:
                msg = self.ws.recv()
                if isinstance(msg, bytes):
                    with self.lock:
                        self.out += msg
                    continue
                data = json.loads(msg)
                kind = data.get("type")
                if kind == "SettingsApplied":
                    self.ready.set()
                elif kind == "Error" and not self.ready.is_set():
                    self.failed = data.get("description") or data.get("message") or str(data)
                    self.ready.set()
                with self.lock:
                    handler = self.handler
                    if handler is None:
                        self.pending.append(data)
                if handler is not None:
                    self._dispatch(handler, data)
        except Exception as e:
            if not self.closed:
                self.audit.event("voice_agent_closed", reason=str(e)[:200])
        finally:
            self.closed = True
            self.ready.set()


def open_link(session, prompt: str, greeting: str) -> Optional[Link]:
    """Connect to the Voice Agent before the call is answered (the Deepgram
    card only; None otherwise)."""
    if not enabled():
        return None
    try:
        return Link.open(session.call_id, session.audit, prompt, greeting)
    except Exception as e:
        logger.warning(f"Call {session.call_id[:8]}: Voice Agent pre-connect failed: {e}")
        return None


def converse(session, *, prompt: str, greeting: str, transcript: list, save: Callable[[], None],
             user_role: str = "caller", decide: Optional[Callable[[str], Optional[tuple]]] = None,
             on_outcome: Optional[Callable[[str, str, dict], None]] = None,
             lookup: Optional[Callable[[str], str]] = None,
             deadline: Optional[float] = None, should_stop: Callable[[], bool] = lambda: False,
             link: Optional[Link] = None, on_meeting: Optional[Callable[[str, str], None]] = None) -> str:
    """Hold the call's conversation on the Deepgram Voice Agent.

    session: the sip_dialer call session (its line, clock and audit).
    link: the connection opened while the phone rang (open_link); without
      one it is opened now.
    decide(text) -> (outcome, words) | None: the guardrails on each caller
      sentence (call_intents); a decision ends the call after the agent's reply.
    on_outcome(outcome, heard, details): record what was decided.
    lookup(question) -> str: the knowledge base search.
    Returns "done", "unavailable" (nothing said: use the Standard way) or
    "dropped" (the connection broke mid-call)."""
    audit = session.audit
    if link is None:
        link = Link.open(session.call_id, audit, prompt, greeting)
    link.ready.wait(CONNECT_TIMEOUT)
    if link.failed or not link.ready.is_set() or (link.closed and not link.out):
        why = link.failed or "no answer from Deepgram"
        logger.warning(f"Call {session.call_id[:8]}: Deepgram Voice Agent not started ({why}); "
                       "using the Standard voice pipeline")
        audit.event("voice_agent_unavailable", error=why)
        link.close()
        return "unavailable"

    s = link.settings
    last_user = {"text": ""}
    outcome_box = {"outcome": None}
    st = {"end_at": None, "audio_done_at": 0.0, "agent_started_at": 0.0, "last_activity": time.time(),
          "idle_prompted": False,
          # The opening plays to the end: a "hello?" as they pick up must not cut it off.
          "protect": bool(greeting), "greeting_done": False}

    def decided(outcome: str, heard: str, details: dict) -> None:
        if outcome_box["outcome"] is None or outcome_box["outcome"] in ("completed", "end_call"):
            outcome_box["outcome"] = outcome
            if on_outcome:
                on_outcome(outcome, heard, details)
        if st["end_at"] is None:
            st["end_at"] = time.time()
            session.ending = True

    def on_function(fn: dict) -> None:
        name = fn.get("name")
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except ValueError:
            args = {}
        audit.event("voice_agent_function", function=name, arguments=args)
        if name == "end_call":
            outcome = args.get("outcome") if args.get("outcome") in OUTCOMES else "completed"
            decided(outcome, last_user["text"], args)
            content = "The call will end now. Say one short, polite goodbye."
        elif name == "request_meeting":
            when = str(args.get("when") or "")
            try:
                if on_meeting:
                    notes = str(args.get("notes") or "").strip()
                    on_meeting(when, last_user["text"] + (f" ({notes})" if notes else ""))
                content = ("Passed to the recruitment team. Tell them the team will contact them to confirm the "
                           "meeting, then ask if there's anything else.")
            except Exception as e:
                logger.warning(f"Meeting request not recorded: {e}")
                content = "It could not be recorded: give them the company's contact details instead."
        elif name == "lookup_company_info":
            found = ""
            try:
                found = (lookup(str(args.get("question") or "")) if lookup else "") or ""
            except Exception as e:
                logger.warning(f"Knowledge lookup failed: {e}")
            content = found or "Nothing about that in the company knowledge. Say you don't have that information."
        else:
            content = "Unknown function."
        link.send_json({"type": "FunctionCallResponse", "id": fn.get("id"), "name": name, "content": content})

    def handle(data: dict) -> None:
        kind = data.get("type")
        if kind == "ConversationText":
            text = (data.get("content") or "").strip()
            if not text:
                return
            st["last_activity"] = time.time()
            role = "agent" if data.get("role") == "assistant" else user_role
            last = transcript[-1] if transcript else {}
            if role == "agent" and last == {"role": "agent", "text": text}:
                return                  # the greeting, already written down
            # Deepgram sends a turn sentence by sentence: one line per turn.
            if last.get("role") == role and not last.get("interrupted"):
                last["text"] = f"{last['text']} {text}"
            else:
                transcript.append({"role": role, "text": text})
            if role == "agent":
                audit.event("agent_speaks", text=text, engine="deepgram-agent")
            else:
                heard = transcript[-1]["text"]
                last_user["text"] = heard
                audit.event("heard", text=text, engine="deepgram-agent")
                hit = decide(heard) if decide else None
                if hit:
                    decided(hit[0], heard, {"said": hit[1], "by": "guardrails"})
            save()
        elif kind == "UserStartedSpeaking":
            st["last_activity"] = time.time()
            st["idle_prompted"] = False
            if st["protect"]:
                audit.event("talk_during_greeting", note="the greeting keeps playing")
                return
            with link.lock:
                dropped = len(link.out)
                link.out.clear()        # barge-in: stop the agent now
            if dropped and transcript and transcript[-1].get("role") == "agent":
                transcript[-1]["interrupted"] = True
                audit.event("barge_in", dropped_seconds=round(dropped / 8000, 2))
        elif kind == "AgentStartedSpeaking":
            st["agent_started_at"] = time.time()
            st["last_activity"] = time.time()
        elif kind == "AgentAudioDone":
            st["audio_done_at"] = time.time()
            st["last_activity"] = time.time()
            st["greeting_done"] = True
        elif kind == "FunctionCallRequest":
            for fn in data.get("functions") or []:
                if fn.get("client_side", True):
                    on_function(fn)
        elif kind == "Error":
            why = data.get("description") or data.get("message") or str(data)
            audit.event("voice_agent_error", error=why, code=data.get("code"))
            logger.warning(f"Call {session.call_id[:8]}: Deepgram Voice Agent error: {why}")
        elif kind == "Warning":
            audit.event("voice_agent_warning", warning=data.get("description") or str(data))

    if greeting:
        transcript.append({"role": "agent", "text": greeting})
        save()
    link.bind(handle)
    with link.lock:
        ready_audio = len(link.out)
    audit.event("voice_agent_started", llm=f"{s['deepgram'].get('agent_llm_provider')}/"
                                           f"{s['deepgram'].get('agent_llm_model')}",
                voice=s["deepgram"].get("tts_voice"), stt=s["deepgram"].get("stt_model"),
                greeting_ready_seconds=round(ready_audio / 8000, 1),
                connected_seconds_ago=round(time.time() - link.started, 1))
    logger.info(f"Call {session.call_id[:8]}: on the Deepgram Voice Agent")
    session.clock = time.time()          # don't play catch-up with audio from the connect wait
    line_end = time.time()
    result = "done"
    timed_out = False
    try:
        while session._answered() and not should_stop():
            pcm16 = session._frame_in()
            link.send_audio(pcm16)
            now = time.time()
            with link.lock:
                while link.out and line_end < now + PLAY_AHEAD:
                    chunk = bytes(link.out[:800])
                    del link.out[:800]
                    session._write(chunk)
                    line_end = max(line_end, now) + len(chunk) / 8000.0
                pending = len(link.out)
            if st["protect"] and st["greeting_done"] and not pending and now > line_end:
                st["protect"] = False   # the opening has played: the caller may now interrupt
            if link.closed and not pending and now > line_end:
                if st["end_at"] is None:
                    result = "dropped"
                    logger.warning(f"Call {session.call_id[:8]}: the Deepgram Voice Agent connection closed mid-call")
                break
            if st["end_at"] is not None:
                # Hang up once the goodbye has played (or it never comes).
                agent_quiet = st["audio_done_at"] >= st["agent_started_at"]
                said_goodbye = st["audio_done_at"] > st["end_at"] or (agent_quiet and now - st["end_at"] > 4)
                if (said_goodbye and not pending and now > line_end + 0.4) or now - st["end_at"] > END_GRACE:
                    break
                continue
            if deadline and now > deadline and not timed_out:
                timed_out = True
                link.send_json({"type": "InjectAgentMessage",
                                "message": "I'm afraid we've reached the time limit for this call. Thank you, goodbye."})
                decided("end_call", "", {"reason": "time limit"})
                continue
            idle = now - st["last_activity"]
            if not pending and now > line_end and idle > IDLE_PROMPT and not st["idle_prompted"]:
                st["idle_prompted"] = True
                st["last_activity"] = now
                link.send_json({"type": "InjectAgentMessage", "message": "Are you still there?"})
            elif st["idle_prompted"] and idle > IDLE_END and not pending and now > line_end:
                link.send_json({"type": "InjectAgentMessage",
                                "message": "I can't hear anything, so I'll end the call now. Goodbye."})
                decided("end_call", "", {"reason": "silence"})
    finally:
        link.close()
        save()
    return result

