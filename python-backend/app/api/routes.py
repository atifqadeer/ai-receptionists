"""
API Routes - All endpoint definitions for the AI Receptionist Hub
"""

import uuid
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Request
from loguru import logger

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
    
    # Get greeting from agent
    agent = request.app.state.ai_agent
    greeting = agent.get_config().greeting
    
    return {
        "call_id": call.call_id,
        "status": call.status,
        "greeting": greeting,
        "started_at": call.started_at.isoformat()
    }


@agent_router.post("/call/{call_id}/end")
async def end_call(request: Request, call_id: str):
    """End an active call"""
    call_manager = request.app.state.call_manager
    agent = request.app.state.ai_agent
    
    log = await call_manager.end_call(call_id)
    agent.end_call(call_id)
    
    farewell = agent.get_config().farewell
    return {
        "status": "ended",
        "call_log": log,
        "farewell": farewell
    }


# ---- Automation Router ----
automation_router = APIRouter()

# In-memory automation rules (in production, use database)
_automation_rules = [
    AutomationRule(id=1, name="After Hours Routing", trigger="Call outside business hours", action="Play recorded message + offer callback", enabled=True, priority=1),
    AutomationRule(id=2, name="Appointment Booking", trigger="Intent: Appointment", action="Collect date/time → Confirm → Send SMS", enabled=True, priority=2),
    AutomationRule(id=3, name="Emergency Escalation", trigger="Keywords: emergency, urgent, help", action="Immediately transfer to on-call staff", enabled=True, priority=0),
    AutomationRule(id=4, name="VIP Caller Detection", trigger="Caller ID matches VIP list", action="Skip queue → Transfer to manager", enabled=False, priority=1),
    AutomationRule(id=5, name="Survey Collection", trigger="Call resolved successfully", action="Ask for satisfaction rating 1-5", enabled=True, priority=5),
    AutomationRule(id=6, name="Voicemail Fallback", trigger="No agent available after 30s", action="Offer voicemail + email notification", enabled=True, priority=4),
]

_workflows = [
    Workflow(id=1, name="New Customer Onboarding", steps=5, status="active", calls=234),
    Workflow(id=2, name="Appointment Reminder", steps=3, status="active", calls=567),
    Workflow(id=3, name="Payment Collection", steps=4, status="paused", calls=89),
    Workflow(id=4, name="Feedback Survey", steps=2, status="active", calls=1023),
]


@automation_router.get("/rules")
async def get_automation_rules():
    """Get all automation rules"""
    return sorted(_automation_rules, key=lambda r: r.priority)


@automation_router.post("/rules")
async def create_automation_rule(rule: dict):
    """Create a new automation rule"""
    new_rule = AutomationRule(
        id=len(_automation_rules) + 1,
        name=rule.get("name", ""),
        trigger=rule.get("trigger", ""),
        action=rule.get("action", ""),
        enabled=True,
        priority=len(_automation_rules) + 1
    )
    _automation_rules.append(new_rule)
    return new_rule


@automation_router.put("/rules/{rule_id}/toggle")
async def toggle_rule(rule_id: int):
    """Toggle an automation rule on/off"""
    for rule in _automation_rules:
        if rule.id == rule_id:
            rule.enabled = not rule.enabled
            return {"status": "success", "rule": rule}
    raise HTTPException(status_code=404, detail="Rule not found")


@automation_router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int):
    """Delete an automation rule"""
    global _automation_rules
    _automation_rules = [r for r in _automation_rules if r.id != rule_id]
    return {"status": "deleted"}


@automation_router.get("/workflows")
async def get_workflows():
    """Get all workflows"""
    return _workflows


@automation_router.put("/workflows/{wf_id}/toggle")
async def toggle_workflow(wf_id: int):
    """Toggle a workflow"""
    for wf in _workflows:
        if wf.id == wf_id:
            wf.status = "paused" if wf.status == "active" else "active"
            return {"status": "success", "workflow": wf}
    raise HTTPException(status_code=404, detail="Workflow not found")


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


# ---- Analytics Router ----
analytics_router = APIRouter()


@analytics_router.get("/dashboard")
async def get_dashboard_stats(request: Request):
    """Get dashboard statistics"""
    call_manager = request.app.state.call_manager
    stats = await call_manager.get_call_stats()
    
    return {
        "total_calls": stats.get("total_calls", 1247),
        "calls_handled": stats.get("resolved", 1189),
        "avg_response_time": 1.2,
        "satisfaction_rate": 94.7,
        "resolution_rate": stats.get("resolution_rate", 95.3),
        "transfer_rate": stats.get("transfer_rate", 4.7),
    }


@analytics_router.get("/hourly")
async def get_hourly_distribution():
    """Get hourly call distribution"""
    return [
        {"hour": "8AM", "calls": 12}, {"hour": "9AM", "calls": 45},
        {"hour": "10AM", "calls": 67}, {"hour": "11AM", "calls": 54},
        {"hour": "12PM", "calls": 38}, {"hour": "1PM", "calls": 42},
        {"hour": "2PM", "calls": 58}, {"hour": "3PM", "calls": 49},
        {"hour": "4PM", "calls": 36}, {"hour": "5PM", "calls": 28},
        {"hour": "6PM", "calls": 15}, {"hour": "7PM", "calls": 8},
    ]


@analytics_router.get("/intents")
async def get_intent_distribution():
    """Get intent distribution"""
    return [
        {"name": "Appointment Booking", "count": 423, "percentage": 34},
        {"name": "General Inquiry", "count": 312, "percentage": 25},
        {"name": "Business Hours", "count": 187, "percentage": 15},
        {"name": "Technical Support", "count": 156, "percentage": 13},
        {"name": "Complaints", "count": 89, "percentage": 7},
        {"name": "Other", "count": 80, "percentage": 6},
    ]


# ---- Settings Router ----
settings_router = APIRouter()


@settings_router.get("/general")
async def get_general_settings():
    """Get general settings"""
    return {
        "system_name": "AI Receptionist Hub",
        "timezone": "America/New_York",
        "date_format": "MM/DD/YYYY",
        "enable_notifications": True,
        "enable_call_recording": True,
        "enable_transcripts": True,
        "auto_save_transcripts": True,
    }


@settings_router.put("/general")
async def update_general_settings(data: dict):
    """Update general settings"""
    return {"status": "success", "settings": data}


@settings_router.get("/telephony")
async def get_telephony_settings():
    """Get telephony settings"""
    return {
        "provider": "twilio",
        "account_sid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "phone_number": "+1 (555) 123-4567",
        "max_concurrent_calls": 10,
        "enable_sip": False,
    }


@settings_router.put("/telephony")
async def update_telephony_settings(data: dict):
    """Update telephony settings"""
    return {"status": "success", "settings": data}


@settings_router.get("/ai-model")
async def get_ai_model_settings():
    """Get AI model settings"""
    return {
        "provider": "openai",
        "model": "gpt-4-turbo-preview",
        "temperature": 0.7,
        "max_tokens": 500,
        "enable_function_calling": True,
        "enable_memory": True,
    }


@settings_router.put("/ai-model")
async def update_ai_model_settings(data: dict):
    """Update AI model settings"""
    return {"status": "success", "settings": data}


@settings_router.get("/team")
async def get_team_members():
    """Get team members"""
    return [
        {"id": 1, "name": "Alex Thompson", "role": "Admin", "email": "alex@techcorp.com", "status": "active"},
        {"id": 2, "name": "Maria Garcia", "role": "Manager", "email": "maria@techcorp.com", "status": "active"},
        {"id": 3, "name": "James Wilson", "role": "Agent", "email": "james@techcorp.com", "status": "active"},
        {"id": 4, "name": "Sophie Brown", "role": "Agent", "email": "sophie@techcorp.com", "status": "inactive"},
    ]


@settings_router.get("/api-keys")
async def get_api_keys():
    """Get API keys (masked)"""
    return [
        {"name": "Production API Key", "key": "pk_live_••••••••••••••••••••", "created": "2024-01-01", "status": "active"},
        {"name": "Development API Key", "key": "pk_test_••••••••••••••••••••", "created": "2024-01-05", "status": "active"},
        {"name": "Webhook Secret", "key": "whsec_••••••••••••••••••••", "created": "2024-01-01", "status": "active"},
    ]


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
    speech_result = form.get("SpeechResult", "")
    call_sid = form.get("CallSid", "")
    
    logger.info(f"Twilio gather: {speech_result}")
    
    # Process with AI agent
    agent = request.app.state.ai_agent
    response = await agent.process_message(call_sid, speech_result)
    
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>{response.message}</Say>
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
