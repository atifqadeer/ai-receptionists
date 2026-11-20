"""
Direct SIP calling - the "SIP Account" provider.

The backend registers on your PBX (Asterisk, FreeSWITCH, 3CX, ...) with a
SIP account, exactly like a softphone such as MicroSIP, and places job
calls itself:

- SIP signalling and G.711 audio: pyVoIP (UDP only, GPL-3.0)
- the agent's voice: live from Deepgram Aura or Cartesia Sonic, streamed
  as 8 kHz u-law while it plays (app/services/voice.py); Windows' built-in
  speech (System.Speech) when no provider is set up or it fails
- the applicant's words: Vosk offline speech recognition finds when they
  talk and when they stop (model in python-backend/models/vosk-model-small-en-us-0.15);
  Deepgram Nova / Cartesia Ink (or Whisper on this PC) writes down what
  they said

No public URL or cloud account is needed: everything runs on this PC and
talks to the PBX directly. Each call runs in its own thread and reports
back to the outbound call store on the main event loop.
"""

import asyncio
import audioop
import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
import uuid
import wave
from collections import deque
from pathlib import Path
from typing import Callable, Optional

from loguru import logger

from app.services import voice as voice_engine

MODELS = Path(__file__).resolve().parents[2] / "models"
# Speech models, best first: the first one found in models/ is used. The
# small model (40 MB) is the weakest on phone audio and accents; a larger
# one from https://alphacephei.com/vosk/models can simply be unzipped into
# models/. SPEECH_MODEL in .env names a folder to force one.
PREFERRED_MODELS = (
    "vosk-model-en-us-0.22",          # 1.8 GB, most accurate
    "vosk-model-en-in-0.5",           # 1 GB, Indian / South Asian English
    "vosk-model-en-us-0.22-lgraph",   # 128 MB, much better than small
    "vosk-model-small-en-in-0.4",     # 36 MB, Indian / South Asian English
    "vosk-model-small-en-us-0.15",    # 40 MB
)


def model_dir() -> Path:
    forced = (os.getenv("SPEECH_MODEL") or "").strip()
    if forced:
        return MODELS / forced
    for name in PREFERRED_MODELS:
        if (MODELS / name).exists():
            return MODELS / name
    return MODELS / PREFERRED_MODELS[-1]


MODEL_DIR = model_dir()
RING_TIMEOUT = 45          # seconds to wait for an answer
CLOUD_STT_BUDGET = 1.2     # seconds cloud speech-to-text may take before Whisper on this PC is used
CLOUD_STT_MAX = 4.0        # ...when there is no local Whisper to fall back on
CLOUD_STT_SLOW = 2         # slow cloud answers in one call before it switches to local for good
LISTEN_START_TIMEOUT = 8   # seconds of silence before "didn't catch that"
LISTEN_MAX = 20            # longest single answer, seconds
END_OF_SPEECH = 1.0        # silence that ends an answer, seconds
FRAME = 160                # 20 ms of 8 kHz audio
TTS_RATE = 0               # Windows voice speed, -10..10 (0 = the voice's natural pace)

# Barge-in: the applicant talking over the agent stops the agent, and
# what they say is answered.
PLAY_AHEAD = 0.3           # seconds of agent audio queued on the line ahead of time
BARGE_IN_RMS = 250         # loudness (16-bit RMS) that counts as the applicant talking
                           # (measured on a real line: speech 500-1000, line noise 5-25)
BARGE_IN_LOUD = 0.25       # seconds of talking before the agent stops
# Sounds the recogniser produces from line noise; never enough on their own.
_FILLER = {"the", "a", "an", "uh", "um", "huh", "oh", "ah", "er", "hmm", "mm", "and", "i", "it", "is"}
# One of these alone is enough to stop the agent.
_STOP_WORDS = {"wait", "sorry", "hello", "stop", "excuse", "pardon", "hold", "what", "hang", "question"}


def barge_in_words(heard: str, agent_text: str) -> list:
    """Words in `heard` that the applicant really said: not line-noise
    fillers, and not the agent's own words coming back as an echo."""
    agent = set(re.findall(r"[a-z']+", (agent_text or "").lower()))
    return [w for w in re.findall(r"[a-z']+", (heard or "").lower()) if w not in _FILLER and w not in agent]


def is_barge_in(heard: str, agent_text: str) -> bool:
    words = barge_in_words(heard, agent_text)
    return len(words) >= 2 or bool(set(words) & _STOP_WORDS)


class SipError(Exception):
    pass


# ---- the agent's voice (Windows System.Speech) ----

_TTS_SCRIPT = r"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $s.GetInstalledVoices() | Where-Object { $_.Enabled }
$v = $null
if ($env:TTS_VOICE) { $v = $voices | Where-Object { $_.VoiceInfo.Name -like "*$($env:TTS_VOICE)*" } | Select-Object -First 1 }
if (-not $v -and $env:TTS_GENDER) {
  $g = $voices | Where-Object { $_.VoiceInfo.Gender -eq $env:TTS_GENDER }
  $v = $g | Where-Object { $_.VoiceInfo.Culture.Name -eq $env:TTS_LANG } | Select-Object -First 1
  if (-not $v) { $v = $g | Where-Object { $_.VoiceInfo.Culture.Name -like ($env:TTS_LANG.Split('-')[0] + '-*') } | Select-Object -First 1 }
}
if (-not $v) { $v = $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq $env:TTS_LANG } | Select-Object -First 1 }
if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }
$s.Rate = [int]$env:TTS_RATE
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(8000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:TTS_OUT, $fmt)
$s.Speak([IO.File]::ReadAllText($env:TTS_IN, [Text.Encoding]::UTF8))
$s.Dispose()
"""

_tts_cache: dict = {}
_tts_lock = threading.Lock()


# The Windows fallback voice follows the gender of the live voice chosen in
# Settings > Agent > Identity & Voice, so a male agent isn't read out by a
# female voice when the provider is unreachable.
_gender_cache: dict = {"at": 0.0, "gender": ""}


def agent_voice_gender() -> str:
    """"Male" / "Female" for the agent's chosen live voice, "" if unknown."""
    if time.time() - _gender_cache["at"] < 10:
        return _gender_cache["gender"]
    gender = ""
    try:
        s = voice_engine.get_settings()
        if s["tts_provider"] == "cartesia":
            name = (s["cartesia"].get("voice_gender") or "").lower()
        else:
            vid = s["deepgram"].get("tts_voice")
            name = next((g for i, _, g, _, _ in voice_engine.DEEPGRAM_VOICES if i == vid), "")
        gender = {"female": "Female", "male": "Male"}.get(name, "")
    except Exception:
        pass
    _gender_cache.update(at=time.time(), gender=gender)
    return gender


def synthesize(text: str, language: str = "en-GB", voice: str = "") -> bytes:
    """Speech for `text` as 8 kHz G.711 µ-law, the line format (see _fix_pyvoip_audio)."""
    gender = agent_voice_gender()
    key = (text, language, voice, gender, TTS_RATE)
    with _tts_lock:
        if key in _tts_cache:
            return _tts_cache[key]
    with tempfile.TemporaryDirectory() as tmp:
        txt, wav = os.path.join(tmp, "say.txt"), os.path.join(tmp, "say.wav")
        Path(txt).write_text(text, encoding="utf-8")
        env = {**os.environ, "TTS_IN": txt, "TTS_OUT": wav, "TTS_LANG": language or "en-GB",
               "TTS_RATE": str(TTS_RATE), "TTS_GENDER": gender,
               "TTS_VOICE": "" if (voice or "").lower().startswith("polly.") else (voice or "")}
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", _TTS_SCRIPT],
                           env=env, capture_output=True, timeout=60)
        if r.returncode != 0 or not os.path.exists(wav):
            raise SipError("Text-to-speech failed: " + r.stderr.decode(errors="ignore")[:200])
        with wave.open(wav, "rb") as w:
            pcm16 = w.readframes(w.getnframes())
    audio = audioop.lin2ulaw(pcm16, 2)
    with _tts_lock:
        if len(_tts_cache) > 50:
            _tts_cache.clear()
        _tts_cache[key] = audio
    return audio


class Speech:
    """The agent's next sentence as 8 kHz u-law, filled in by a background
    thread while it is generated, so the call plays the first words as soon
    as the provider sends them. Falls back to the Windows voice when the
    live voice fails before sending any audio."""

    CACHE_MAX = 300           # sentences up to this long are cached

    def __init__(self, text: str, language: str, windows_voice: str):
        self.text, self.language, self.windows_voice = text, language, windows_voice
        self.buf = bytearray()
        self.lock = threading.Lock()
        self.first = threading.Event()   # some audio is ready (or there will be none)
        self.done = threading.Event()
        self.cancelled = False
        self.engine = voice_engine.active_tts()
        self.error = ""
        self.started = time.time()
        self.first_seconds: Optional[float] = None
        s = voice_engine.get_settings()
        self.key = (self.engine, s["deepgram"].get("tts_voice") if self.engine == "deepgram" else
                    (s["cartesia"].get("voice_id"), s["cartesia"].get("tts_model"), s["cartesia"].get("speed")),
                    text)
        with _tts_lock:
            cached = _tts_cache.get(self.key) if self.engine != "windows" else None
        if cached is not None:
            self._add(cached)
            self.first_seconds = 0.0
            self._finish()
        else:
            threading.Thread(target=self._run, daemon=True, name="tts").start()

    def _add(self, part: bytes) -> None:
        with self.lock:
            self.buf += part
        if self.first_seconds is None:
            self.first_seconds = round(time.time() - self.started, 2)
        self.first.set()

    def _finish(self) -> None:
        self.first.set()
        self.done.set()

    def _run(self) -> None:
        try:
            if self.engine != "windows":
                try:
                    for part in voice_engine.stream_speech(self.text, "mulaw"):
                        if self.cancelled:
                            return
                        self._add(part)
                    if len(self.text) <= self.CACHE_MAX and not self.cancelled:
                        with _tts_lock:
                            if len(_tts_cache) > 200:
                                _tts_cache.clear()
                            _tts_cache[self.key] = bytes(self.buf)
                    return
                except Exception as e:
                    self.error = f"{self.engine}: {e}"
                    if self.buf:          # cut off mid-sentence: play what arrived
                        logger.warning(f"Live voice stopped mid-sentence ({e})")
                        return
                    logger.warning(f"Live voice unavailable ({e}); using the Windows voice")
                    self.engine = "windows"
            self._add(synthesize(self.text, self.language, self.windows_voice))
        except Exception as e:
            self.error = str(e)
            logger.error(f"Text-to-speech failed: {e}")
        finally:
            self._finish()

    def audio(self) -> bytes:
        with self.lock:
            return bytes(self.buf)

    def cancel(self) -> None:
        self.cancelled = True


# ---- the applicant's words (Vosk) ----

_model = None
_model_lock = threading.Lock()


def speech_model():
    global _model
    with _model_lock:
        if _model is None:
            if not MODEL_DIR.exists():
                raise SipError(f"Speech recognition model not found in {MODEL_DIR}")
            from vosk import Model, SetLogLevel
            SetLogLevel(-1)
            _model = Model(str(MODEL_DIR))
            logger.info(f"Speech recognition model: {MODEL_DIR.name}")
        return _model


# The model listens at 16 kHz; a phone line carries 8 kHz audio.
MODEL_RATE = 16000


def to_model_rate(pcm16_8k: bytes, state=None) -> tuple:
    """8 kHz 16-bit audio upsampled for the model: (audio, resampler state)."""
    return audioop.ratecv(pcm16_8k, 2, 1, 8000, MODEL_RATE, state)


def transcribe_pcm16(pcm16: bytes) -> str:
    """Text of 8 kHz 16-bit audio (used by tests)."""
    from vosk import KaldiRecognizer
    rec = KaldiRecognizer(speech_model(), MODEL_RATE)
    rec.AcceptWaveform(to_model_rate(pcm16)[0])
    return json.loads(rec.FinalResult()).get("text", "")


# Word confidence (0-1) from the recogniser: a reply made of mostly
# low-confidence words is noise or a bad line, so the agent asks the
# applicant to repeat it instead of acting on it.
LOW_CONFIDENCE = 0.6       # a word below this is a guess
UNCLEAR_SHARE = 0.5        # this share of guessed words makes a reply unclear


def new_recognizer():
    from vosk import KaldiRecognizer
    rec = KaldiRecognizer(speech_model(), MODEL_RATE)
    rec.SetWords(True)
    return rec


def take_result(raw: str, confs: list) -> str:
    """Text of a recogniser result; its word confidences are added to `confs`."""
    r = json.loads(raw)
    confs.extend(float(w.get("conf", 1.0)) for w in r.get("result", []))
    return r.get("text", "")


def is_unclear(confs: list) -> bool:
    return bool(confs) and sum(c < LOW_CONFIDENCE for c in confs) / len(confs) >= UNCLEAR_SHARE


# ---- what the applicant said: Whisper ----
#
# The small Vosk model can't follow many accents on a phone line: on test
# calls "what is the salary?" came out as "where did the telly" and "like a
# that henry". Vosk still does the instant work (noticing the applicant
# talk over the agent, and the end of their answer); Whisper (faster-whisper,
# model in models/whisper-small.en) then writes down that stretch of audio.
# Without the model or package, calls fall back to Vosk's text.

WHISPER_DIR = MODELS / "whisper-small.en"
WHISPER_WINDOW = 10        # seconds Whisper looks at per pass (its default 30 is ~3x slower)
WHISPER_PROMPT = ("A job applicant on the phone asks a recruiter about a job: "
                  "the salary, pay, working hours, location, start date, benefits.")
WHISPER_UNSURE = -1.0      # average log-probability below this: ask the applicant to repeat
WHISPER_SILENCE = 0.6      # no-speech probability above this (and unsure): nothing was said

_whisper = None
_whisper_failed = False
_whisper_lock = threading.Lock()


def whisper_model():
    """The Whisper model, loaded once; None when it isn't available."""
    global _whisper, _whisper_failed
    with _whisper_lock:
        if _whisper is None and not _whisper_failed:
            if not WHISPER_DIR.exists():
                _whisper_failed = True
                logger.warning(f"Whisper model not found in {WHISPER_DIR}: using Vosk for speech-to-text")
                return None
            try:
                from faster_whisper import WhisperModel
                t = time.time()
                _whisper = WhisperModel(str(WHISPER_DIR), device="cpu", compute_type="int8",
                                        cpu_threads=os.cpu_count() or 4)
                logger.info(f"Speech-to-text: Whisper {WHISPER_DIR.name} loaded in {time.time() - t:.1f}s")
            except Exception as e:
                _whisper_failed = True
                logger.warning(f"Whisper unavailable ({e}): using Vosk for speech-to-text")
        return _whisper


def whisper_transcribe(pcm16_8k: bytes, hint: str = "", prompt: str = WHISPER_PROMPT) -> Optional[dict]:
    """{"text", "logprob", "no_speech", "seconds"} for 8 kHz 16-bit audio,
    or None when Whisper isn't available."""
    model = whisper_model()
    if model is None or not pcm16_8k:
        return None
    import numpy as np
    audio = np.frombuffer(to_model_rate(pcm16_8k)[0], dtype=np.int16).astype(np.float32) / 32768.0
    t = time.time()
    with _whisper_lock:
        segments, _ = model.transcribe(
            audio, language="en", beam_size=5, initial_prompt=(prompt + " " + hint).strip(),
            without_timestamps=True, condition_on_previous_text=False, vad_filter=False,
            chunk_length=WHISPER_WINDOW)
        segments = list(segments)
    if not segments:
        return {"text": "", "logprob": 0.0, "no_speech": 1.0, "seconds": round(time.time() - t, 2)}
    return {"text": " ".join(x.text.strip() for x in segments).strip(),
            "logprob": round(min(x.avg_logprob for x in segments), 2),
            "no_speech": round(max(x.no_speech_prob for x in segments), 2),
            "seconds": round(time.time() - t, 2)}


def trim_silence(pcm16: bytes, pad: float = 0.3) -> bytes:
    """`pcm16` from `pad` seconds before its first voice to `pad` seconds
    after its last. Silence at either end makes Whisper invent words."""
    step = FRAME * 2
    loud = [i for i in range(0, len(pcm16) - step + 1, step) if audioop.rms(pcm16[i:i + step], 2) > BARGE_IN_RMS]
    if not loud:
        return pcm16
    margin = int(pad * 8000) * 2
    return pcm16[max(0, loud[0] - margin):loud[-1] + step + margin]


def preload_speech() -> None:
    """Load the speech models in the background, so the first answer of
    the first call isn't slowed by loading them."""
    def load():
        try:
            speech_model()
        except Exception as e:
            logger.warning(f"Vosk model: {e}")
        whisper_model()
    threading.Thread(target=load, daemon=True, name="speech-preload").start()


# ---- the SIP phone ----

def _local_ip(server: str, port: int) -> str:
    """This PC's address on the network that reaches the PBX."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((server, port))
        return s.getsockname()[0]
    finally:
        s.close()


def _account(creds: dict) -> tuple:
    server = re.sub(r"^(sips?:|https?://)", "", (creds.get("server") or "").strip()).strip("/")
    if ":" in server:
        server, port = server.rsplit(":", 1)
    else:
        port = creds.get("port") or "5060"
    return server, int(port), (creds.get("username") or "").strip(), creds.get("password") or "", \
        int(creds.get("local_port") or 5062)


def _fix_pyvoip_ack() -> None:
    """pyVoIP 1.6.8 bug: the ACK for the PBX's "200 OK" carries a new,
    random To-tag instead of the tag the PBX sent, and reuses the INVITE's
    Via branch. The PBX can't match that ACK to the call, keeps resending
    its 200 OK, and hangs up after 32 seconds (SIP timer H), mid-sentence.
    Send the PBX's own To-tag, and a new branch for a 2xx ACK (RFC 3261
    13.2.2.4, 17.1.1.3)."""
    import pyVoIP.VoIP  # noqa: F401  (must load before pyVoIP.SIP: circular import)
    from pyVoIP import SIP
    if getattr(SIP.SIPClient, "_ack_fixed", False):
        return
    original = SIP.SIPClient.gen_ack

    def gen_ack(self, request):
        message = original(self, request)
        to_tag = (request.headers.get("To") or {}).get("tag", "").split(";")[0].strip()
        lines = message.split("\r\n")
        for i, line in enumerate(lines):
            if line.startswith("To: ") and to_tag:
                lines[i] = re.sub(r";tag=[^;]*$", "", line) + f";tag={to_tag}"
            elif line.startswith("Via: ") and request.status == SIP.SIPStatus.OK:
                lines[i] = re.sub(r";branch=[^;]*", f";branch=z9hG4bK{uuid.uuid4().hex[:20]}", line)
        return "\r\n".join(lines)

    SIP.SIPClient.gen_ack = gen_ack
    SIP.SIPClient._ack_fixed = True


# Line audio. pyVoIP 1.6.8 decodes the caller's G.711 audio to 8-bit
# linear (audioop.ulaw2lin(payload, 1)) and encodes ours from 8-bit, which
# throws away most of the detail of quiet speech: the recogniser then hears
# "where did the telly" for words it would otherwise get right, and the
# applicant hears a hissy agent. Instead the line carries G.711 µ-law bytes
# untouched (still one byte per sample, so pyVoIP's buffering is the same);
# this module decodes them to 16-bit itself, and encodes the agent's voice
# from 16-bit.
ULAW_SILENCE = b"\xff"


def _fix_pyvoip_audio() -> None:
    import pyVoIP.VoIP  # noqa: F401  (must load before pyVoIP.RTP: circular import)
    from pyVoIP import RTP
    if getattr(RTP.RTPClient, "_ulaw_fixed", False):
        return

    def read(self, length: int = 160) -> bytes:
        # pyVoIP pads a short buffer with 0x80, 8-bit silence; in µ-law
        # that is a full-scale click, so pad with µ-law silence.
        while self.rebuilding:
            time.sleep(0.01)
        with self.bufferLock:
            packet = self.buffer.read(length)
        if len(packet) < length:
            packet += ULAW_SILENCE * (length - len(packet))
        return packet

    def write(self, offset: int, data: bytes) -> None:
        # pyVoIP writes each packet at its timestamp; a packet that is lost
        # (or arrives after the next one) leaves a hole that io.BytesIO fills
        # with 0x00 bytes, which in µ-law is a full-scale click (-32124).
        # On a lossy line the caller's audio becomes loud noise: the
        # recogniser hears no words and never detects the end of speech.
        # Fill holes with µ-law silence instead; a late packet still lands
        # in its slot. Counts gaps for the call's line-quality report.
        self.bufferLock.acquire()
        self.log[offset] = data
        bufferloc = self.buffer.tell()
        if offset < self.offset:
            reset = abs(offset - self.offset) >= 100000
            self.offset = offset
            self.bufferLock.release()
            self.rebuild(reset, offset, data)
            return
        pos = offset - self.offset
        end = self.buffer.seek(0, 2)
        if pos > end:
            gap = pos - end
            if gap > 8000 * 5:          # a timestamp jump, not loss: don't fill seconds of silence
                gap = 0
            self.gap_bytes = getattr(self, "gap_bytes", 0) + gap
            self.buffer.write(ULAW_SILENCE * gap)
        elif pos < end:
            self.late_bytes = getattr(self, "late_bytes", 0) + len(data)
        self.data_bytes = getattr(self, "data_bytes", 0) + len(data)
        self.buffer.seek(pos, 0)
        self.buffer.write(data)
        self.buffer.seek(bufferloc, 0)
        self.bufferLock.release()

    def parse_pcmu(self, packet) -> None:
        self.pmin.write(packet.timestamp, packet.payload)

    def parse_pcma(self, packet) -> None:
        self.pmin.write(packet.timestamp, audioop.lin2ulaw(audioop.alaw2lin(packet.payload, 2), 2))

    def encode_pcmu(self, packet: bytes) -> bytes:
        return packet

    def encode_pcma(self, packet: bytes) -> bytes:
        return audioop.lin2alaw(audioop.ulaw2lin(packet, 2), 2)

    RTP.RTPPacketManager.read = read
    RTP.RTPPacketManager.write = write
    RTP.RTPClient.parse_pcmu = parse_pcmu
    RTP.RTPClient.parse_pcma = parse_pcma
    RTP.RTPClient.encode_pcmu = encode_pcmu
    RTP.RTPClient.encode_pcma = encode_pcma
    RTP.RTPClient._ulaw_fixed = True


def line_to_pcm16(frame: bytes) -> bytes:
    """Line audio (µ-law) as 16-bit linear."""
    return audioop.ulaw2lin(frame, 2)


# Requests a PBX sends outside a call: OPTIONS keep-alives ("qualify"),
# NOTIFY (voicemail lights), INFO, MESSAGE. pyVoIP 1.6.8 can't parse them,
# and one arriving while it waits for the answer to a call's INVITE aborts
# the call ("Unable to decipher SIP request: OPTIONS ..."). They are
# accepted and answered with 200 OK, which also keeps the PBX seeing us
# as reachable.
_EXTRA_METHODS = ("OPTIONS", "NOTIFY", "INFO", "MESSAGE")


def _ok_for(raw: bytes) -> str:
    """A minimal 200 OK for a SIP request (its Via, From, To, Call-ID, CSeq)."""
    head = raw.split(b"\r\n\r\n", 1)[0].decode("utf-8", "replace").split("\r\n")
    lines = ["SIP/2.0 200 OK"]
    for line in head[1:]:
        name = line.split(":", 1)[0].strip().lower()
        if name in ("via", "v", "from", "f", "call-id", "i", "cseq"):
            lines.append(line)
        elif name in ("to", "t"):
            lines.append(line if ";tag=" in line else f"{line};tag={uuid.uuid4().hex[:10]}")
    lines += ["Allow: INVITE, ACK, BYE, CANCEL, OPTIONS", "Content-Length: 0", "", ""]
    return "\r\n".join(lines)


def _fix_pyvoip_requests() -> None:
    import pyVoIP
    import pyVoIP.VoIP  # noqa: F401  (must load before pyVoIP.SIP: circular import)
    from pyVoIP import SIP
    if getattr(SIP.SIPClient, "_requests_fixed", False):
        return
    for m in _EXTRA_METHODS:
        if m not in pyVoIP.SIPCompatibleMethods:
            pyVoIP.SIPCompatibleMethods.append(m)
    original = SIP.SIPClient.parse_message

    def parse_message(self, message):
        if message.type == SIP.SIPMessageType.MESSAGE and message.method in _EXTRA_METHODS:
            try:
                self.out.sendto(_ok_for(message.raw).encode("utf8"), (self.server, self.port))
            except Exception as e:
                logger.debug(f"SIP: could not answer {message.method}: {e}")
            return
        return original(self, message)

    SIP.SIPClient.parse_message = parse_message
    SIP.SIPClient._requests_fixed = True


_REJECTED = {486: "Busy", 600: "Busy", 603: "Declined", 480: "Unavailable", 408: "No answer",
             487: "Cancelled", 403: "Forbidden", 484: "Incomplete number", 488: "Not acceptable"}


def _fix_pyvoip_responses() -> None:
    """pyVoIP 1.6.8 bugs in what it does with answers to its own calls:
    - the PBX's "200 OK" to our CANCEL is taken as the call being
      answered (it only looks at Call-ID): ignore 2xx answers to CANCEL;
    - final rejections of an INVITE (486 busy, 603 declined, 487 after a
      CANCEL, ...) are dropped: the call stays "dialling" for the whole
      ring timeout and the PBX keeps resending them for want of an ACK.
      ACK them and end the call, keeping the reason on call.sip_reason."""
    import pyVoIP.VoIP  # noqa: F401  (must load before pyVoIP.SIP: circular import)
    from pyVoIP import SIP
    from pyVoIP.VoIP import CallState
    if getattr(SIP.SIPClient, "_responses_fixed", False):
        return
    original = SIP.SIPClient.parse_message

    def parse_message(self, message):
        if message.type != SIP.SIPMessageType.MESSAGE:
            method = (message.headers.get("CSeq") or {}).get("method", "")
            code = int(message.status)
            if method == "CANCEL":
                # The PBX's answer to our CANCEL: 200 = it will stop ringing.
                logger.info(f"SIP: PBX answered our CANCEL with {code} {message.status.phrase} "
                            f"(call {str(message.headers.get('Call-ID'))[:8]})")
                if code < 300:
                    _cancel_confirmed.add(message.headers.get("Call-ID"))
                return
            if method == "INVITE" and code >= 300 and code not in (401, 407, 404, 503):
                call = getattr(self.phone, "calls", {}).get(message.headers.get("Call-ID"))
                try:
                    self.out.sendto(self.gen_ack(message).encode("utf8"), (self.server, self.port))
                except Exception as e:
                    logger.debug(f"SIP: could not ACK {code}: {e}")
                logger.info(f"SIP: call {str(message.headers.get('Call-ID'))[:8]} ended by the PBX: "
                            f"{code} {message.status.phrase}")
                if call is not None and call.state in (CallState.DIALING, CallState.RINGING):
                    call.sip_reason = f"{_REJECTED.get(code, message.status.phrase or 'Rejected')} ({code})"
                    call.state = CallState.ENDED
                return
        return original(self, message)

    SIP.SIPClient.parse_message = parse_message
    SIP.SIPClient._responses_fixed = True


_cancel_confirmed: set = set()   # Call-IDs whose CANCEL the PBX answered with 200


def cancel_invite(call, on_result: Optional[Callable] = None) -> None:
    """Stop a call that is still ringing (pyVoIP can only hang up answered
    calls): send the PBX a CANCEL for our INVITE (RFC 3261 section 9.1:
    same Request-URI, Via branch, From, To, Call-ID and CSeq number)."""
    from pyVoIP.VoIP import CallState
    raw = call.request.raw.decode("utf8", "replace") if isinstance(call.request.raw, bytes) else str(call.request.raw)
    lines = raw.split("\r\n\r\n")[0].split("\r\n")
    uri = lines[0].split(" ")[1]
    keep = {}
    for line in lines[1:]:
        name = line.split(":", 1)[0].strip().lower()
        if name in ("via", "from", "to", "call-id") and name not in keep:
            keep[name] = line
        elif name == "cseq" and "cseq" not in keep:
            keep["cseq"] = f"CSeq: {line.split(':', 1)[1].split()[0]} CANCEL"
    message = (f"CANCEL {uri} SIP/2.0\r\n{keep['via']}\r\nMax-Forwards: 70\r\n{keep['to']}\r\n{keep['from']}\r\n"
               f"{keep['call-id']}\r\n{keep['cseq']}\r\nContent-Length: 0\r\n\r\n")
    sip = call.phone.sip
    call_id = call.request.headers.get("Call-ID")

    def send():
        # UDP can lose it: resend (RFC 3261 timer E: 0.5 s, 1 s, 2 s) until
        # the PBX confirms with 200 OK.
        for wait in (0.5, 1.0, 2.0, 0):
            try:
                sip.out.sendto(message.encode("utf8"), (sip.server, sip.port))
            except OSError as e:
                logger.warning(f"SIP: could not send CANCEL: {e}")
                return
            time.sleep(wait)
            if call_id in _cancel_confirmed:
                _cancel_confirmed.discard(call_id)
                if on_result:
                    on_result("confirmed by the PBX (200 OK): the other phone stopped ringing")
                return
        logger.warning(f"SIP: the PBX never confirmed our CANCEL for call {str(call_id)[:8]}: "
                       "the other phone may keep ringing")
        if on_result:
            on_result("NOT confirmed by the PBX after 4 tries: the other phone may keep ringing")

    logger.info(f"SIP: cancelling ringing call {str(call_id)[:8]}")
    threading.Thread(target=send, daemon=True, name="sip-cancel").start()
    if call.state in (CallState.DIALING, CallState.RINGING):
        call.sip_reason = "Cancelled"
        call.state = CallState.ENDED


INVITE_TIMEOUT = 8   # seconds to wait for the PBX to take a call request


def _fix_pyvoip_bye() -> None:
    """Note the moment the PBX reports that the other side hung up (BYE)
    on the call object, so the call's event log shows how fast the agent
    stopped. Also logs a BYE for a call pyVoIP no longer knows."""
    import pyVoIP.VoIP as V
    if getattr(V.VoIPPhone, "_bye_noted", False):
        return
    original = V.VoIPPhone._callback_MSG_Bye

    def _callback_MSG_Bye(self, request):
        call = self.calls.get(request.headers.get("Call-ID"))
        if call is not None:
            call.bye_at = time.time()
        else:
            logger.info(f"SIP: BYE for an unknown call {str(request.headers.get('Call-ID'))[:8]}")
        return original(self, request)

    V.VoIPPhone._callback_MSG_Bye = _callback_MSG_Bye
    V.VoIPPhone._bye_noted = True


def _fix_pyvoip_invite_timeout() -> None:
    """pyVoIP 1.6.8 waits for the PBX's first answer to a call request
    (100 Trying / 180 Ringing / 401) with a blocking recv and no time limit,
    holding the SIP lock: when the PBX never answers (rate-limited, busy,
    packet lost) the call hangs on "dialling" forever, Hang up can't act,
    and the registration refresh stalls. Give it INVITE_TIMEOUT seconds."""
    import pyVoIP.VoIP  # noqa: F401  (must load before pyVoIP.SIP: circular import)
    from pyVoIP import SIP
    if getattr(SIP.SIPClient, "_invite_timeout_fixed", False):
        return
    original = SIP.SIPClient.invite

    def invite(self, number, ms, sendtype):
        sock = self.s
        sock.settimeout(INVITE_TIMEOUT)
        try:
            return original(self, number, ms, sendtype)
        except (socket.timeout, TimeoutError):
            raise SipError(f"The PBX did not respond to the call request within {INVITE_TIMEOUT} seconds. "
                           "It may be rate-limiting this computer; try again in a minute.")
        finally:
            try:
                sock.settimeout(None)   # back to blocking, as pyVoIP expects
            except OSError:
                pass

    SIP.SIPClient.invite = invite
    SIP.SIPClient._invite_timeout_fixed = True


def _fix_pyvoip_invite_retransmit() -> None:
    """An incoming call: when our "200 OK" answer is lost, the PBX resends
    the INVITE. pyVoIP 1.6.8 treats that as a re-negotiation, restarts the
    call's audio ports and fails. Resend the same answer instead."""
    import pyVoIP.VoIP as V
    if getattr(V.VoIPPhone, "_retransmit_fixed", False):
        return
    original = V.VoIPPhone._callback_MSG_Invite

    def _callback_MSG_Invite(self, request):
        call = self.calls.get(request.headers.get("Call-ID"))
        if call is not None and call.state == V.CallState.ANSWERED                 and request.headers["CSeq"]["check"] == call.request.headers["CSeq"]["check"]:
            m = {x.inPort: x.assoc for x in call.RTPClients}
            message = self.sip.gen_answer(request, call.session_id, m, call.sendmode)
            self.sip.out.sendto(message.encode("utf8"), (self.server, self.port))
            return
        return original(self, request)

    V.VoIPPhone._callback_MSG_Invite = _callback_MSG_Invite
    V.VoIPPhone._retransmit_fixed = True


class SipPhone:
    """One registered SIP account. `on_call(call)` is run (in its own
    thread) for each incoming call; without it incoming calls get "busy"."""

    def __init__(self, rtp_low: int = 20000, rtp_high: int = 20200, on_call: Optional[Callable] = None,
                 label: str = "SIP"):
        self.phone = None
        self.key = None
        self.lock = threading.Lock()
        self.rtp_low, self.rtp_high, self.on_call, self.label = rtp_low, rtp_high, on_call, label

    def ensure(self, creds: dict):
        """The registered phone for these credentials (re-registers when
        they change). Raises SipError when registration fails."""
        from pyVoIP.VoIP import VoIPPhone, PhoneStatus
        _fix_pyvoip_ack()
        _fix_pyvoip_requests()
        _fix_pyvoip_audio()
        _fix_pyvoip_invite_retransmit()
        _fix_pyvoip_responses()
        _fix_pyvoip_invite_timeout()
        _fix_pyvoip_bye()
        key = _account(creds)
        with self.lock:
            if self.phone is not None and self.key == key and self.phone._status == PhoneStatus.REGISTERED:
                return self.phone
            self._stop()
            server, port, user, password, local_port = key
            if not (server and user and password):
                raise SipError("SIP server, username and password are required")
            try:
                ip = _local_ip(server, port)
            except OSError as e:
                raise SipError(f"Cannot reach SIP server {server}:{port}: {e}")
            phone = VoIPPhone(server, port, user, password, myIP=ip, sipPort=local_port,
                              callCallback=self.on_call, rtpPortLow=self.rtp_low, rtpPortHigh=self.rtp_high)
            try:
                phone.start()
            except OSError as e:
                raise SipError(f"Could not open local SIP port {local_port} ({e}). "
                               "Is another softphone using it? Choose a different Local SIP port.")
            except Exception as e:
                phone.stop()
                raise SipError(f"Registration failed: {e}")
            deadline = time.time() + 10
            while phone._status != PhoneStatus.REGISTERED and time.time() < deadline:
                if phone._status in (PhoneStatus.FAILED, PhoneStatus.INACTIVE):
                    break
                time.sleep(0.2)
            if phone._status != PhoneStatus.REGISTERED:
                try:
                    phone.stop()
                except Exception:
                    pass
                raise SipError(f"The PBX at {server}:{port} did not accept the registration for "
                               f"'{user}'. Check the username, password and server (UDP).")
            self.phone, self.key = phone, key
            logger.info(f"{self.label}: registered {user}@{server}:{port} from {ip}:{local_port}")
            return phone

    def _stop(self):
        if self.phone is not None:
            try:
                self.phone.stop()
            except Exception:
                pass
        self.phone, self.key = None, None

    def stop(self):
        with self.lock:
            self._stop()

    def registered(self) -> bool:
        from pyVoIP.VoIP import PhoneStatus
        return self.phone is not None and self.phone._status == PhoneStatus.REGISTERED


sip_phone = SipPhone()


def test_registration(creds: dict) -> dict:
    try:
        sip_phone.ensure(creds)
        server, port, user, _, local_port = _account(creds)
        return {"ok": True, "message": f"Registered {user} on {server}:{port} (local port {local_port})."}
    except SipError as e:
        return {"ok": False, "message": str(e)}
    except Exception as e:
        return {"ok": False, "message": f"SIP error: {e}"}


# ---- call audit: what happened on each SIP call, for checking afterwards ----

AUDIT_DIR = Path(__file__).resolve().parents[2] / "data" / "call_audit"
AUDIT_KEEP = 100           # newest call audits (recordings) kept on disk


class CallAudit:
    """Event log (events.jsonl) and a stereo recording (call.wav: left =
    applicant, right = agent) of one call, in data/call_audit/. Times are
    seconds since the call was answered."""

    def __init__(self, call_id: str, dial: str, first_event: str = "dialing"):
        stamp = time.strftime("%Y%m%d-%H%M%S")
        self.dir = AUDIT_DIR / f"{stamp}_{call_id[:8]}"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.t0 = time.time()
        self.inbound = bytearray()     # 8 kHz 16-bit, one frame per frame read
        self.outbound = bytearray()    # agent audio placed at its play time
        self.event(first_event, target=dial, call_id=call_id)
        self._prune()

    def now(self) -> float:
        return round(time.time() - self.t0, 2)

    def event(self, name: str, **data) -> None:
        line = json.dumps({"t": self.now(), "event": name, **data}, ensure_ascii=False)
        try:
            with open(self.dir / "events.jsonl", "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass

    def answered(self) -> None:
        self.t0 = time.time()
        self.inbound.clear()
        self.outbound.clear()
        self.event("answered")

    def heard(self, pcm16: bytes) -> None:
        self.inbound += pcm16

    def spoke(self, ulaw: bytes) -> None:
        """Agent audio written to the line now (µ-law)."""
        at = max(len(self.outbound), int((time.time() - self.t0) * 8000) * 2)
        if at > len(self.outbound):
            self.outbound += b"\x00" * (at - len(self.outbound))
        self.outbound += line_to_pcm16(ulaw)

    def save(self) -> None:
        n = max(len(self.inbound), len(self.outbound))
        left = bytes(self.inbound) + b"\x00" * (n - len(self.inbound))
        right = bytes(self.outbound) + b"\x00" * (n - len(self.outbound))
        stereo = audioop.add(audioop.tostereo(left, 2, 1, 0), audioop.tostereo(right, 2, 0, 1), 2)
        try:
            with wave.open(str(self.dir / "call.wav"), "wb") as w:
                w.setnchannels(2)
                w.setsampwidth(2)
                w.setframerate(8000)
                w.writeframes(stereo)
        except OSError as e:
            logger.warning(f"Call audit: could not save the recording: {e}")

    @staticmethod
    def _prune() -> None:
        try:
            old = sorted(p for p in AUDIT_DIR.iterdir() if p.is_dir())[:-AUDIT_KEEP]
            for p in old:
                for f in p.iterdir():
                    f.unlink()
                p.rmdir()
        except OSError:
            pass


# ---- one call ----

class SipCallSession(threading.Thread):
    """Dial, present the job, listen and answer until the call ends."""

    AUDIT_FIRST_EVENT = "dialing"

    def __init__(self, settings: dict, dial: str, call_id: str, loop: asyncio.AbstractEventLoop,
                 make_conversation: Callable):
        super().__init__(daemon=True, name=f"sip-call-{call_id[:8]}")
        self.settings, self.dial, self.call_id, self.loop = settings, dial, call_id, loop
        self.make_conversation = make_conversation
        self.call = None
        self.audit = CallAudit(call_id, dial, self.AUDIT_FIRST_EVENT)
        self.clock = 0.0          # when the next incoming frame is due (call-wide)
        self.we_hung_up = False
        self.unclear = False      # the last reply heard was mostly guessed words
        self.whisper_hint = ""     # the job, so Whisper expects its words
        self.whisper_prompt = WHISPER_PROMPT
        self.cloud_slow = 0        # cloud speech-to-text answers that missed their time budget
        self.ending = False        # the agent is saying goodbye (so the call isn't "hung up" by them)

    # Run a coroutine of the call store on the main loop and wait for it.
    def _store(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout=30)

    def line_quality(self) -> dict:
        """How much of the caller's audio arrived: missing = holes left by
        lost packets (filled with silence), late = packets that arrived
        after a later one. A few % is a normal internet line; above ~5%
        speech recognition suffers."""
        try:
            pm = self.call.RTPClients[0].pmin
        except Exception:
            return {}
        got, gap, late = getattr(pm, "data_bytes", 0), getattr(pm, "gap_bytes", 0), getattr(pm, "late_bytes", 0)
        total = got + gap
        if not total:
            return {"received_seconds": 0}
        missing = max(0, gap - late)
        return {"received_seconds": round(got / 8000, 1), "missing_audio_pct": round(missing / total * 100, 1),
                "late_packets_pct": round(late / total * 100, 1)}

    def _answered(self) -> bool:
        from pyVoIP.VoIP import CallState
        return self.call is not None and self.call.state == CallState.ANSWERED

    def _frame_in(self):
        """The next 20 ms from the line as 16-bit audio.

        Incoming audio queues up in pyVoIP while the agent's next sentence
        is being synthesised. One clock for the whole call lets the reader
        run faster than real time until it has caught up, instead of
        falling further behind the applicant with every turn."""
        frame = self.call.read_audio(FRAME, blocking=False)
        pcm16 = line_to_pcm16(frame)
        self.audit.heard(pcm16)
        self.clock += FRAME / 8000.0
        behind = time.time() - self.clock
        if behind > 5:                  # far behind (packet loss): resync
            self.clock = time.time()
        elif behind < 0:
            time.sleep(-behind)
        return pcm16

    def _write(self, chunk: bytes) -> None:
        self.call.write_audio(chunk)
        self.audit.spoke(chunk)

    def say(self, text: str, interruptible: bool = True):
        """Speak `text`, listening all the while. When the applicant talks
        over the agent, the agent stops and this returns the recogniser
        holding their words so far (listen() carries on with it); otherwise
        returns None once the agent has finished."""
        speech = Speech(text, self.settings.get("language") or "en-GB", self.settings.get("voice") or "")
        speech.first.wait(timeout=20)
        if not self._answered():
            speech.cancel()
            return None
        self.audit.event("agent_speaks", text=text, engine=speech.engine, first_audio_seconds=speech.first_seconds,
                         interruptible=interruptible, listen_lag=round(time.time() - self.clock, 2))
        rec = new_recognizer()
        resample, heard, loud, peak, ignored, confs = None, "", 0, 0, "", []
        recent = deque(maxlen=150)  # the last 3 s from the line: the start of an interruption
        need_loud = int(BARGE_IN_LOUD * 8000 / FRAME)
        start = time.time()
        line_end = start            # when the audio queued on the line finishes playing
        pos = 0
        while self._answered():
            now = time.time()
            elapsed = now - start
            # Feed the line a little ahead, so stopping is quick. The audio
            # may still be arriving from the provider.
            audio = speech.audio()
            while pos < len(audio) and line_end < now + PLAY_AHEAD:
                chunk = audio[pos:pos + FRAME * 5]
                self._write(chunk)
                pos += len(chunk)
                line_end = max(line_end, now) + len(chunk) / 8000.0
            if speech.done.is_set() and pos >= len(speech.audio()) and now > line_end + 0.2:
                self.audit.event("agent_done", peak_line_rms=peak, engine=speech.engine,
                                 seconds=round(pos / 8000.0, 1), error=speech.error or None)
                return None
            pcm16 = self._frame_in()
            recent.append(pcm16)
            rms = audioop.rms(pcm16, 2)
            peak = max(peak, rms)
            if interruptible:
                loud = loud + 1 if rms > BARGE_IN_RMS else max(0, loud - 1)
                model_audio, resample = to_model_rate(pcm16, resample)
                if rec.AcceptWaveform(model_audio):
                    heard = (heard + " " + take_result(rec.Result(), confs)).strip()
                    current = heard
                else:
                    current = (heard + " " + json.loads(rec.PartialResult()).get("partial", "")).strip()
                if current and current != ignored and loud >= need_loud and not is_barge_in(current, text):
                    ignored = current
                    self.audit.event("talk_ignored", heard=current, rms=rms,
                                     reason="not enough words yet, or the agent's own words (echo)")
                if loud >= need_loud and is_barge_in(current, text):
                    speech.cancel()
                    logger.info(f"SIP call {self.call_id}: applicant interrupted: {current!r}")
                    self.audit.event("barge_in", heard=current, rms=rms, after_seconds=round(elapsed, 2),
                                     agent_said_seconds=round(min(elapsed, pos / 8000.0), 2),
                                     of_seconds=round(len(speech.audio()) / 8000.0, 1))
                    return {"rec": rec, "resample": resample, "heard": heard, "confs": confs,
                            "audio": b"".join(recent)}
                if not loud and heard and not is_barge_in(heard, text):
                    heard, confs = "", []  # noise or echo: forget it
        speech.cancel()
        return None

    def _transcribe(self, clip: bytes) -> tuple:
        """(cloud result, Whisper result) for the caller's answer; one of
        them is None. The cloud service (Deepgram / Cartesia) gets
        CLOUD_STT_BUDGET seconds, while Whisper on this PC writes the same
        answer down at the same time, so the caller is never kept waiting.
        When the cloud is slower, Whisper's text is used, and after
        CLOUD_STT_SLOW slow answers the call stops using the cloud service
        altogether (on a slow internet line it took 5-19 s per sentence)."""
        if self.cloud_slow >= CLOUD_STT_SLOW or voice_engine.active_stt() == "local":
            return None, whisper_transcribe(clip, self.whisper_hint, self.whisper_prompt)
        box: dict = {}
        done, local_done = threading.Event(), threading.Event()

        def run():
            try:
                box["result"] = voice_engine.transcribe(clip, self.whisper_hint)
            finally:
                done.set()

        def run_local():
            try:
                box["whisper"] = whisper_transcribe(clip, self.whisper_hint, self.whisper_prompt)
            except Exception as e:
                logger.warning(f"Whisper failed: {e}")
            finally:
                local_done.set()

        threading.Thread(target=run, daemon=True, name="cloud-stt").start()
        threading.Thread(target=run_local, daemon=True, name="local-stt").start()
        if done.wait(CLOUD_STT_BUDGET) and box.get("result") is not None:
            self.cloud_slow = 0
            return box["result"], None
        local_done.wait(30)
        whisper = box.get("whisper")
        if whisper is None and not done.is_set():   # no local Whisper: give the cloud a little longer
            done.wait(max(0.0, CLOUD_STT_MAX - CLOUD_STT_BUDGET))
        if done.is_set() and box.get("result") is None:
            return None, whisper                     # the cloud failed (not slow): nothing to count
        if done.is_set() and box.get("result") is not None:
            return box["result"], None
        self.cloud_slow += 1
        self.audit.event("cloud_stt_slow", budget_seconds=CLOUD_STT_BUDGET, slow_answers=self.cloud_slow,
                         switched_to_local=self.cloud_slow >= CLOUD_STT_SLOW)
        if self.cloud_slow == CLOUD_STT_SLOW:
            logger.warning(f"Call {self.call_id[:8]}: cloud speech-to-text is too slow on this connection; "
                           "using Whisper on this PC for the rest of the call")
        return None, whisper

    def listen(self, barge: Optional[dict] = None) -> str:
        """The applicant's answer. `barge`: they started talking over the
        agent; carry on from what was heard. Vosk finds the end of the
        answer; Whisper (when available) writes down what was said."""
        if barge:
            rec, resample, said, confs = barge["rec"], barge["resample"], barge["heard"], list(barge["confs"])
            audio = bytearray(barge["audio"])
        else:
            rec, resample, said, confs = new_recognizer(), None, "", []
            audio = bytearray()
        # Times on the audio clock, so a backlog doesn't cut the answer short.
        start = last_voice = self.clock
        heard = bool(barge)
        voice_from = 0 if barge else None   # where speech starts in `audio`
        voice_to = len(audio)                # where it last had voice
        partial = ""
        self.audit.event("listening", after_barge_in=bool(barge))
        while self._answered():
            pcm16 = self._frame_in()
            audio += pcm16
            loud = audioop.rms(pcm16, 2) > BARGE_IN_RMS
            model_audio, resample = to_model_rate(pcm16, resample)
            if rec.AcceptWaveform(model_audio):
                said = (said + " " + take_result(rec.Result(), confs)).strip()
                partial = ""
            else:
                now_partial = json.loads(rec.PartialResult()).get("partial", "")
                if now_partial != partial:
                    partial = now_partial
                    loud = loud or bool(now_partial)
            if loud:
                if voice_from is None:
                    voice_from = max(0, len(audio) - 2 * 8000)  # from 1 s before the voice
                heard, last_voice = True, self.clock
                voice_to = len(audio)
            now = self.clock
            if (not heard and now - start > LISTEN_START_TIMEOUT) or now - start > LISTEN_MAX \
                    or (heard and now - last_voice > END_OF_SPEECH):
                break
        vosk_text = (said + " " + take_result(rec.FinalResult(), confs)).strip()
        result, self.unclear, whisper, cloud = vosk_text, bool(vosk_text) and is_unclear(confs), None, None
        if heard and voice_from is not None and self._answered():
            # Up to 0.3 s after the last voice: trailing silence makes Whisper invent words ("you").
            clip = trim_silence(bytes(audio[voice_from:voice_to + int(0.3 * 8000) * 2]))
            cloud, whisper = self._transcribe(clip)
        if cloud is not None:
            text = re.sub(r"\s+", " ", cloud["text"]).strip()
            if not re.search(r"[a-z]", text.lower()):
                result, self.unclear = ("", False) if not vosk_text else (vosk_text, True)
            else:
                result, self.unclear = text, cloud["confidence"] < voice_engine.UNSURE
        elif whisper is not None:
            text = re.sub(r"\s+", " ", whisper["text"]).strip()
            nothing = whisper["no_speech"] > WHISPER_SILENCE and whisper["logprob"] < WHISPER_UNSURE
            if nothing or not re.search(r"[a-z]", text.lower()):
                result, self.unclear = ("", False) if not vosk_text else (vosk_text, True)
            else:
                result, self.unclear = text, whisper["logprob"] < WHISPER_UNSURE
        self.audit.event("heard", text=result, vosk=vosk_text, whisper=whisper, cloud=cloud,
                         seconds=round(self.clock - start, 1), confidence=[round(c, 2) for c in confs],
                         unclear=self.unclear, listen_lag=round(time.time() - self.clock, 2))
        return result

    def run(self) -> None:
        from app.services import outbound
        from pyVoIP.VoIP import CallState
        final = "failed"
        try:
            whisper_model()   # loaded before dialling, not during the first answer
            phone = sip_phone.ensure(self.settings["credentials"]["sip"])
            self.call = phone.call(self.dial)
            self._store(outbound.update_call(self.call_id, status="ringing"))
            self.audit.event("ringing")
            deadline = time.time() + RING_TIMEOUT
            while self.call.state == CallState.DIALING and time.time() < deadline:
                time.sleep(0.2)
            if self.call.state != CallState.ANSWERED:
                final = "no_answer"
                self.audit.event("not_answered", state=str(self.call.state))
                if self.call.state == CallState.DIALING:
                    logger.info(f"SIP call {self.call_id}: no answer after {RING_TIMEOUT}s")
                return
            self.audit.answered()
            self.clock = time.time()
            self._store(outbound.update_call(self.call_id, status="in_progress", answered_at=outbound._now()))
            record = outbound.get_call(self.call_id)
            job = record.get("job", {})
            self.whisper_hint = " ".join(f"{k.replace('_', ' ')}: {job[k]}." for k in
                                         ("job_title", "employer", "location") if job.get(k))
            conv = self.make_conversation(record)
            transcript = []

            def save():
                self._store(outbound.update_call(self.call_id, transcript=list(transcript),
                                                 state=record.get("state", {}), outcome=record.get("outcome"),
                                                 notes=record.get("notes", [])))

            def turn(text: str, end: bool):
                """Say `text`; the applicant may talk over it (not over a goodbye)."""
                if end:
                    self.ending = True
                transcript.append({"role": "agent", "text": text})
                save()
                barge = self.say(text, interruptible=not end)
                if barge:
                    transcript[-1]["interrupted"] = True
                return barge

            barge = turn(conv.opening(), False)
            unclear_streak = 0
            while self._answered():
                interrupted = barge is not None
                heard = self.listen(barge)
                if not self._answered():
                    break
                # A garbled reply: ask again rather than act on a guess
                # (twice at most, then go with what was heard).
                if heard and self.unclear and unclear_streak < 2:
                    unclear_streak += 1
                    transcript.append({"role": "applicant", "text": heard, "interrupted": interrupted, "unclear": True})
                    ask = conv.unclear(heard, interrupted=interrupted)
                    self.audit.event("reply", heard=heard, interrupted=interrupted, end_call=False, kind="unclear",
                                     outcome=record.get("outcome"))
                    barge = turn(ask, False)
                    continue
                unclear_streak = 0
                if heard:
                    transcript.append({"role": "applicant", "text": heard, "interrupted": interrupted})
                reply, end = conv.reply(heard, interrupted=interrupted)
                notes = record.get("notes") or []
                self.audit.event("reply", heard=heard, interrupted=interrupted, end_call=end,
                                 kind=notes[-1]["kind"] if heard and notes else "silence",
                                 outcome=record.get("outcome"))
                barge = turn(reply, end)
                if end:
                    break
            save()
            final = "completed"
            if not self.ending and not self._answered():
                final = "hung_up"          # the applicant put the phone down mid-conversation
                self.audit.event("hung_up", by="applicant")
        except Exception as e:
            logger.warning(f"SIP call {self.call_id} failed: {e}")
            self.audit.event("error", error=str(e))
            try:
                self._store(outbound.update_call(self.call_id, error=str(e)))
            except Exception:
                pass
            final = "failed"
        finally:
            if self._answered():
                try:
                    time.sleep(0.5)
                    self.we_hung_up = True
                    self.call.hangup()
                except Exception:
                    pass
            if self.call is not None and self.audit.inbound:
                self.audit.event("line_quality", **self.line_quality())
                self.audit.event("call_ended", by="agent" if self.we_hung_up else "other side (BYE from PBX/phone)",
                                 state=str(self.call.state), result=final)
            self.audit.save()
            try:
                self._store(outbound.finish_call(self.call_id, final))
            except Exception as e:
                logger.error(f"SIP call {self.call_id}: could not record the result: {e}")


def dial_target(number: str, settings: dict) -> str:
    """What to dial on the PBX: extensions as they are; phone numbers in
    national format (+447700900123 -> 07700900123) with the outside-line
    prefix, if the PBX needs one."""
    creds = settings.get("credentials", {}).get("sip", {})
    if re.fullmatch(r"\d{3,6}", number or ""):
        return number
    cc = re.sub(r"\D", "", settings.get("default_country_code") or "")
    digits = number.lstrip("+")
    national = "0" + digits[len(cc):] if cc and digits.startswith(cc) else "00" + digits
    return (creds.get("outside_prefix") or "").strip() + national


def start_call(settings: dict, number: str, call_id: str, make_conversation: Callable) -> str:
    """Start a SIP call in the background; returns at once."""
    loop = asyncio.get_running_loop()
    SipCallSession(settings, dial_target(number, settings), call_id, loop, make_conversation).start()
    return f"sip-{call_id[:8]}"
