"""
Routes for VoIP settings, outbound job calls and the provider voice webhooks.

  /api/telephony/...   VoIP provider settings (Agent Setup > VoIP & Calling)
  /api/outbound/...    applicants queue, CRM webhook, CSV upload/template
  /webhooks/voice/...  called by the VoIP provider during a call
"""

import asyncio
import hmac
import json
import re
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response
from loguru import logger

from app.services import call_rules
from app.services import dnc, inbound, outbound, telephony
from app.services.knowledge import KnowledgeBase

telephony_router = APIRouter()
outbound_router = APIRouter()
voice_router = APIRouter()


# ---- VoIP settings ----

@telephony_router.get("/settings")
async def get_telephony_settings():
    s = telephony.load_settings()
    out = telephony.public_settings(s)
    out["missing"] = telephony.missing_settings(s)
    out["within_calling_hours"] = telephony.within_calling_hours(s)
    return out


@telephony_router.put("/settings")
async def save_telephony_settings(data: dict):
    s = telephony.update_settings(data)
    inbound.inbound_line.apply()  # re-register the inbound extension with the new settings
    out = telephony.public_settings(s)
    out["missing"] = telephony.missing_settings(s)
    return out


# ---- inbound calls (auto-answer on an extension) ----

@telephony_router.get("/inbound")
async def inbound_status():
    calls = inbound.list_calls()
    return {"status": inbound.inbound_line.status(), "calls": calls, "stats": inbound.stats(calls)}


@telephony_router.delete("/inbound/calls")
async def clear_inbound_calls():
    inbound.clear_calls()
    return {"ok": True}


@telephony_router.get("/inbound/calls/{call_id}")
async def inbound_call_detail(call_id: str):
    """One inbound call: its record, the event log (what was heard and
    said, barge-ins) and whether its recording is still kept."""
    call = inbound.get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return {**call, "events": inbound.call_events(call), "has_recording": inbound.recording_file(call) is not None}


@telephony_router.get("/inbound/calls/{call_id}/recording")
async def inbound_call_recording(call_id: str):
    """The call recording (WAV, stereo: left = caller, right = agent)."""
    call = inbound.get_call(call_id)
    path = inbound.recording_file(call) if call else None
    if not path:
        raise HTTPException(status_code=404, detail="No recording for this call")
    return FileResponse(path, media_type="audio/wav", filename=f"inbound-{call.get('caller_number', 'call')}-{call_id[:8]}.wav")


@telephony_router.delete("/inbound/calls/{call_id}")
async def delete_inbound_call(call_id: str):
    if not inbound.delete_call(call_id):
        raise HTTPException(status_code=404, detail="Call not found")
    return {"ok": True}


# ---- dial pad (Make a Call): the agent phones a number over the SIP Account ----

@telephony_router.get("/dialed")
async def dialed_calls():
    return {"calls": inbound.list_calls("outbound")[:50]}


@telephony_router.get("/dial/opening")
async def default_dial_opening():
    """The opening the agent says on dial-pad calls when none is given."""
    return {"opening": inbound.DEFAULT_DIAL_OPENING}


@telephony_router.post("/dial")
async def dial_number(request: Request, data: dict):
    number = re.sub(r"[^\d+*#]", "", str(data.get("number") or ""))
    if not re.fullmatch(r"\+?[\d*#]{2,20}", number):
        raise HTTPException(status_code=400, detail="Enter a phone number or extension to call.")
    try:
        call_id = inbound.dial(number, str(data.get("name") or "")[:80], request.app.state.ai_agent,
                               asyncio.get_running_loop(), opening=str(data.get("opening") or "")[:600])
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": call_id}


@telephony_router.post("/dialed/{call_id}/hangup")
async def hangup_dialed(call_id: str):
    if not inbound.hangup(call_id):
        raise HTTPException(status_code=404, detail="That call is not in progress")
    return {"ok": True}


@telephony_router.delete("/dialed")
async def clear_dialed_calls():
    inbound.clear_calls("outbound")
    return {"ok": True}


@telephony_router.post("/test")
async def test_telephony():
    return await telephony.test_connection(telephony.load_settings())


@telephony_router.post("/webhook-token")
async def new_webhook_token():
    return {"webhook_token": telephony.regenerate_webhook_token()}


# ---- applicants and calls ----

@outbound_router.get("/calls")
async def list_outbound_calls():
    s = telephony.load_settings()
    calls = outbound.list_calls()
    return {
        "calls": calls,
        "call_mode": s.get("call_mode"),
        "configured": telephony.is_configured(s),
        "missing": telephony.missing_settings(s),
        "within_calling_hours": telephony.within_calling_hours(s),
        "webhook_token": s.get("webhook_token"),
    }


@outbound_router.post("/webhook")
async def crm_webhook(request: Request, token: Optional[str] = None):
    """Your CRM posts applicants here. Accepts one applicant object, a list,
    or {"applicants": [...]} / {"data": [...]}. Authenticate with the
    X-Webhook-Token header or ?token=..."""
    expected = telephony.load_settings().get("webhook_token") or ""
    given = request.headers.get("x-webhook-token") or token or ""
    if not given or not expected or not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid or missing webhook token")
    raw = await request.body()
    body = None
    if "form" not in (request.headers.get("content-type") or ""):
        # JSON; some CRMs send Windows-1252 text (e.g. "£") instead of UTF-8.
        for enc in ("utf-8-sig", "cp1252"):
            try:
                body = json.loads(raw.decode(enc))
                break
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
    if body is None:
        form = await request.form()
        body = dict(form)
        if not body:
            raise HTTPException(status_code=400, detail="Body is not valid JSON or form data")
    if isinstance(body, dict):
        items = body.get("applicants") or body.get("data") or body.get("records") or [body]
    elif isinstance(body, list):
        items = body
    else:
        raise HTTPException(status_code=400, detail="Expected a JSON object or list")
    records = [outbound.normalize_record(r) for r in items if isinstance(r, dict)]
    return await outbound.add_records(records, source="webhook")


@outbound_router.post("/crm/pull")
async def crm_pull():
    """Fetch applicants from the CRM API now and queue the new ones."""
    try:
        return await outbound.pull_from_crm()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---- Do Not Call list: numbers that asked not to be called again ----

@outbound_router.get("/dnc")
async def dnc_list():
    return {"numbers": await asyncio.to_thread(dnc.entries)}


@outbound_router.post("/dnc")
async def dnc_add(data: dict):
    number = str(data.get("number") or "").strip()
    try:
        entry = await asyncio.to_thread(dnc.add, number, "added in the dashboard", "", "", str(data.get("name") or "")[:80])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return entry


@outbound_router.delete("/dnc/{number}")
async def dnc_remove(number: str):
    if not await asyncio.to_thread(dnc.remove, number):
        raise HTTPException(status_code=404, detail="That number is not on the Do Not Call list")
    return {"ok": True}


@outbound_router.get("/crm/status")
async def crm_status():
    return outbound.crm_status()


@outbound_router.post("/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file")
    content = await file.read()
    if len(content) > 5_000_000:
        raise HTTPException(status_code=400, detail="CSV is larger than 5 MB")
    records = outbound.parse_csv(content)
    if not records:
        raise HTTPException(status_code=400, detail="No rows found in the CSV")
    return await outbound.add_records(records, source=f"csv:{file.filename}")


@outbound_router.get("/template.csv")
async def csv_template():
    return PlainTextResponse(outbound.template_csv(), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="applicants_template.csv"'})


@outbound_router.post("/calls/{call_id}/dial")
async def dial_now(call_id: str):
    call = outbound.get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    blocked = call_rules.check(call["applicant"]["phone"])
    if blocked:
        raise HTTPException(status_code=409, detail=blocked[1])
    s = telephony.load_settings()
    if not telephony.is_configured(s):
        raise HTTPException(status_code=400, detail="VoIP is not set up: missing " + ", ".join(telephony.missing_settings(s)))
    await outbound.request_dial([call_id])
    await outbound.dialer_pass()
    return outbound.get_call(call_id)


@outbound_router.post("/dial-all")
async def dial_all():
    s = telephony.load_settings()
    if not telephony.is_configured(s):
        raise HTTPException(status_code=400, detail="VoIP is not set up: missing " + ", ".join(telephony.missing_settings(s)))
    n = await outbound.request_dial(None)
    await outbound.dialer_pass()
    return {"requested": n}


@outbound_router.post("/calls/{call_id}/cancel")
async def cancel_call(call_id: str):
    call = outbound.get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if call["status"] not in ("queued",):
        raise HTTPException(status_code=400, detail="Only queued calls can be cancelled")
    return await outbound.update_call(call_id, status="cancelled", dial_requested=False)


@outbound_router.delete("/calls/{call_id}")
async def delete_outbound_call(call_id: str):
    if not await outbound.delete_call(call_id):
        raise HTTPException(status_code=404, detail="Call not found")
    return {"status": "deleted"}


def make_conversation(agent, call: dict) -> outbound.CallConversation:
    """The agent's side of a job call, with its name, company and knowledge."""
    cfg = agent.get_config()
    sources = agent._knowledge_sources()
    kb = KnowledgeBase(sources, cfg.company_name) if sources else None
    return outbound.CallConversation(call, cfg.agent_name, cfg.company_name, kb,
                                     profile=dict(cfg.knowledge_base or {}), think=agent.think)


def _conversation(request: Request, call: dict) -> outbound.CallConversation:
    return make_conversation(request.app.state.ai_agent, call)


# Text preview of a call: test the script without dialling. Kept in memory.
_previews: dict = {}


@outbound_router.post("/calls/{call_id}/preview")
async def preview_call(request: Request, call_id: str, data: Optional[dict] = None):
    """{"reset": true} starts the preview with the opening pitch;
    {"message": "..."} is the applicant's reply."""
    data = data or {}
    call = outbound.get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if data.get("reset") or call_id not in _previews:
        _previews[call_id] = {**json.loads(json.dumps(call)), "state": {}, "outcome": None}
        conv = _conversation(request, _previews[call_id])
        return {"reply": conv.opening(), "ended": False, "outcome": None}
    sim = _previews[call_id]
    conv = _conversation(request, sim)
    reply, ended = await asyncio.to_thread(conv.reply, data.get("message", ""))
    return {"reply": reply, "ended": ended, "outcome": sim.get("outcome")}


# ---- provider voice webhooks (the live call) ----

async def _speech_and_status(request: Request) -> dict:
    """Fields from a provider request: Twilio-style form posts, or Vonage
    JSON events."""
    data = {}
    try:
        if "json" in (request.headers.get("content-type") or ""):
            data = await request.json()
        else:
            data = dict(await request.form())
    except Exception:
        pass
    data.update(dict(request.query_params))
    speech = data.get("SpeechResult")
    if speech is None and isinstance(data.get("speech"), dict):
        results = data["speech"].get("results") or []
        speech = results[0].get("text") if results else ""
    return {"speech": speech or "", "status": data.get("CallStatus") or data.get("status") or "", "raw": data}


def _voice_response(body: str, media_type: str) -> Response:
    return Response(content=body, media_type=media_type)


def _urls(request: Request, cid: str) -> tuple:
    base = telephony.load_settings().get("public_url") or str(request.base_url).rstrip("/")
    return f"{base}/webhooks/voice/gather?cid={cid}", f"{base}/webhooks/voice/noinput?cid={cid}"


async def _say(request: Request, call: dict, text: str, end: bool) -> Response:
    s = telephony.load_settings()
    transcript = call.get("transcript", []) + [{"role": "agent", "text": text}]
    await outbound.update_call(call["id"], transcript=transcript, state=call.get("state", {}),
                               outcome=call.get("outcome"), notes=call.get("notes", []))
    if end:
        return _voice_response(*telephony.say_and_hangup(s, text))
    gather, noinput = _urls(request, call["id"])
    return _voice_response(*telephony.say_and_listen(s, text, gather, noinput))


@voice_router.api_route("/answer", methods=["GET", "POST"])
async def voice_answer(request: Request, cid: str):
    call = outbound.get_call(cid)
    s = telephony.load_settings()
    if not call:
        return _voice_response(*telephony.say_and_hangup(s, "Sorry, this call could not be found. Goodbye."))
    await outbound.update_call(cid, status="in_progress", answered_at=outbound._now())
    conv = _conversation(request, call)
    return await _say(request, call, conv.opening(), end=False)


@voice_router.api_route("/gather", methods=["GET", "POST"])
async def voice_gather(request: Request, cid: str):
    call = outbound.get_call(cid)
    s = telephony.load_settings()
    if not call:
        return _voice_response(*telephony.say_and_hangup(s, "Goodbye."))
    fields = await _speech_and_status(request)
    heard = (fields["speech"] or "").strip()
    if heard:
        call["transcript"] = call.get("transcript", []) + [{"role": "applicant", "text": heard}]
    conv = _conversation(request, call)
    reply, end = await asyncio.to_thread(conv.reply, heard)
    logger.info(f"Outbound {cid}: applicant said {heard!r} -> outcome {call.get('outcome')}")
    return await _say(request, call, reply, end)


@voice_router.api_route("/noinput", methods=["GET", "POST"])
async def voice_noinput(request: Request, cid: str):
    call = outbound.get_call(cid)
    s = telephony.load_settings()
    if not call:
        return _voice_response(*telephony.say_and_hangup(s, "Goodbye."))
    conv = _conversation(request, call)
    reply, end = await asyncio.to_thread(conv.reply, "")
    return await _say(request, call, reply, end)


@voice_router.api_route("/status", methods=["GET", "POST"])
async def voice_status(request: Request, cid: str):
    fields = await _speech_and_status(request)
    status = telephony.STATUS_MAP.get((fields["status"] or "").lower())
    if status:
        if status in ("completed", "no_answer", "busy", "failed", "cancelled"):
            await outbound.finish_call(cid, status)
        else:
            call = outbound.get_call(cid)
            # Events can arrive out of order: never move an answered call
            # back to dialling or ringing.
            if call and not (call["status"] == "in_progress" and status in ("dialing", "ringing")):
                await outbound.update_call(cid, status=status)
    return {"ok": True}
