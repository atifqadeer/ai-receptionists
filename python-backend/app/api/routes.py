"""
API Routes - All endpoint definitions for the AI Receptionist Hub
"""

import asyncio
import uuid
from datetime import datetime
from xml.sax.saxutils import escape
from typing import Optional, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Request, UploadFile, File
from loguru import logger
from app.services import spoken_numbers

from app.models.schemas import (
    AgentConfig, AgentResponse, CallContext, CallLog,
    AutomationRule, Workflow, DashboardStats, TelephonyConfig,
    AIModelConfig, TeamMember, WSMessage
)

# ---- Agent Router ----
agent_router = APIRouter()


@agent_router.get("/config")
async def get_agent_config(request: Request):
    """Get current agent configuration"""
    agent = request.app.state.ai_agent
    return agent.get_config()


@agent_router.put("/config")
async def update_agent_config(request: Request, config: dict):
    """Update agent configuration"""
    agent = request.app.state.ai_agent
    updated = agent.update_config(config)
    return {"status": "success", "config": updated}


# ---- Knowledge documents: .md/.txt files the agent answers from ----

_KNOWLEDGE_EXTENSIONS = (".md", ".markdown", ".txt")
_KNOWLEDGE_MAX_BYTES = 200_000


@agent_router.get("/knowledge/documents")
async def list_knowledge_documents(request: Request):
    """List uploaded knowledge documents (names and sizes)."""
    agent = request.app.state.ai_agent
    return {"documents": agent.list_knowledge_documents()}


@agent_router.post("/knowledge/upload")
async def upload_knowledge_document(request: Request, file: UploadFile = File(...)):
    """Upload a knowledge file (.md, .markdown or .txt). The agent
    answers questions from its contents, together with the rest of
    the knowledge base. Re-uploading the same file name replaces it."""
    name = (file.filename or "").strip()
    if not name.lower().endswith(_KNOWLEDGE_EXTENSIONS):
        raise HTTPException(status_code=400, detail="Only .md, .markdown or .txt files are accepted")
    raw = await file.read()
    if len(raw) > _KNOWLEDGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 200 KB)")
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 text")
    agent = request.app.state.ai_agent
    documents = agent.add_knowledge_document(name, content)
    return {"status": "success", "documents": documents}


@agent_router.delete("/knowledge/documents/{name}")
async def delete_knowledge_document(request: Request, name: str):
    """Remove an uploaded knowledge document by file name."""
    agent = request.app.state.ai_agent
    if not agent.remove_knowledge_document(name):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "success", "documents": agent.list_knowledge_documents()}


@agent_router.post("/chat")
async def chat_with_agent(request: Request, data: dict):
    """Send a message to the AI agent and get a response"""
    agent = request.app.state.ai_agent
    call_id = data.get("call_id", str(uuid.uuid4()))
    message = data.get("message", "")
    
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    
    response = await agent.process_message(call_id, message)
    return response


@agent_router.post("/call/start")
async def start_call(request: Request, data: Optional[dict] = None):
    """Start a new call session"""
    call_manager = request.app.state.call_manager
    data = data or {}
    call = await call_manager.start_call(
        caller_number=data.get("caller_number"),
        caller_name=data.get("caller_name")
    )
    
    # Get greeting from agent. A text chat ({"channel": "chat"}, the
    # dashboard's test chat) uses the chat welcome, not the phone greeting.
    agent = request.app.state.ai_agent
    if data.get("channel") == "chat":
        agent.chat_sessions.add(call.call_id)
        greeting = await asyncio.to_thread(agent.chat_welcome)
    else:
        greeting = agent.get_config().greeting
    
    return {
        "call_id": call.call_id,
        "status": call.status,
        "greeting": greeting,
        "goodbye": (await asyncio.to_thread(agent.chat_goodbye)) if data.get("channel") == "chat" else agent.get_config().farewell,
        "started_at": call.started_at.isoformat()
    }


@agent_router.post("/call/{call_id}/end")
async def end_call(request: Request, call_id: str):
    """End an active call"""
    call_manager = request.app.state.call_manager
    agent = request.app.state.ai_agent
    
    log = await call_manager.end_call(call_id)
    summary = agent.end_call(call_id)

    farewell = agent.get_config().farewell
    return {
        "status": "ended",
        "call_log": log,
        "farewell": farewell,
        # The role discussed and the caller's answers to its screening questions.
        "role": summary.get("role"),
        "screening_answers": summary.get("screening_answers", {}),
    }


# ---- Calls Router ----
calls_router = APIRouter()


@calls_router.get("/active")
async def get_active_calls(request: Request):
    """Get all active calls"""
    call_manager = request.app.state.call_manager
    calls = await call_manager.get_active_calls()
    return calls


@calls_router.get("/history")
async def get_call_history(request: Request, limit: int = 50):
    """Get call history"""
    call_manager = request.app.state.call_manager
    history = await call_manager.get_call_history(limit)
    return history


@calls_router.get("/stats")
async def get_call_stats(request: Request):
    """Get call statistics"""
    call_manager = request.app.state.call_manager
    stats = await call_manager.get_call_stats()
    return stats


@calls_router.post("/{call_id}/transfer")
async def transfer_call(request: Request, call_id: str, data: dict):
    """Transfer a call"""
    call_manager = request.app.state.call_manager
    target = data.get("target", "general")
    success = await call_manager.transfer_call(call_id, target)
    return {"success": success, "target": target}


@calls_router.post("/{call_id}/hold")
async def hold_call(request: Request, call_id: str):
    """Put a call on hold"""
    call_manager = request.app.state.call_manager
    success = await call_manager.hold_call(call_id)
    return {"success": success}


# ---- Webhooks Router ----
webhooks_router = APIRouter()


@webhooks_router.post("/twilio")
async def twilio_webhook(request: Request):
    """Handle incoming Twilio webhooks"""
    form = await request.form()
    call_sid = form.get("CallSid", "")
    caller = form.get("From", "")
    
    logger.info(f"Twilio webhook: Call from {caller}, SID: {call_sid}")
    
    # Return TwiML response
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Hello! Thank you for calling. I'm Aria, your AI assistant. How can I help you today?</Say>
    <Gather input="speech" action="/webhooks/twilio/gather" method="POST" timeout="5">
        <Say>Please tell me what you need help with.</Say>
    </Gather>
</Response>"""
    
    from fastapi.responses import Response
    return Response(content=twiml, media_type="application/xml")


@webhooks_router.post("/twilio/gather")
async def twilio_gather(request: Request):
    """Handle gathered speech from Twilio"""
    form = await request.form()
    speech_result = spoken_numbers.digits(form.get("SpeechResult", ""))
    call_sid = form.get("CallSid", "")
    
    logger.info(f"Twilio gather: {speech_result}")
    
    # Process with AI agent
    agent = request.app.state.ai_agent
    response = await agent.process_message(call_sid, speech_result)
    
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>{escape(response.message or "")}</Say>
    <Gather input="speech" action="/webhooks/twilio/gather" method="POST" timeout="5">
        <Say>Is there anything else I can help you with?</Say>
    </Gather>
</Response>"""
    
    from fastapi.responses import Response
    return Response(content=twiml, media_type="application/xml")


# ---- WebSocket Router ----
websocket_router = APIRouter()


@websocket_router.websocket("/call/{call_id}")
async def websocket_call(websocket: WebSocket, call_id: str):
    """WebSocket endpoint for real-time call interaction"""
    await websocket.accept()
    logger.info(f"WebSocket connected for call: {call_id}")
    
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "text")
            
            if msg_type == "text":
                # Process text message through AI agent
                agent = websocket.app.state.ai_agent
                message = data.get("data", {}).get("message", "")
                
                response = await agent.process_message(call_id, message)
                
                await websocket.send_json({
                    "type": "response",
                    "data": {
                        "message": response.message,
                        "intent": response.intent,
                        "confidence": response.confidence,
                    },
                    "call_id": call_id,
                    "timestamp": datetime.utcnow().isoformat()
                })
            
            elif msg_type == "audio":
                # Handle audio data (speech-to-text would go here)
                await websocket.send_json({
                    "type": "status",
                    "data": {"message": "Audio received, processing..."},
                    "call_id": call_id,
                    "timestamp": datetime.utcnow().isoformat()
                })
            
            elif msg_type == "end_call":
                call_manager = websocket.app.state.call_manager
                await call_manager.end_call(call_id)
                
                await websocket.send_json({
                    "type": "status",
                    "data": {"message": "Call ended"},
                    "call_id": call_id,
                    "timestamp": datetime.utcnow().isoformat()
                })
                break
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for call: {call_id}")
    except Exception as e:
        logger.error(f"WebSocket error for call {call_id}: {e}")
        await websocket.close()
