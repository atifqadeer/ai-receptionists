"""
AI Receptionist Hub - Main Application
FastAPI-based backend for AI-powered receptionist and automation
"""

import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.core.config import settings
from app.core.database import init_db
from app.core import instance_lock
from app.core.security import ALLOWED_ORIGINS, LocalOnlyMiddleware
from app.api.routes import (
    agent_router,
    calls_router,
    analytics_router,
    webhooks_router,
    websocket_router
)
from app.services.ai_agent import AIAgent
from app.services.call_manager import CallManager
from app.services import outbound
from app.services.inbound import inbound_line
from app.api.outbound_routes import telephony_router, outbound_router, voice_router, make_conversation
from app.api.voice_routes import voice_engine_router, store_router
from app.api.chat_routes import chats_router
from app.api.language_routes import languages_router
from app.api.ai_model_routes import ai_model_router
from app.api.call_rules_routes import call_rules_router
from app.api.widget_routes import widget_public_router, widget_admin_router, WidgetCorsMiddleware
from app.core import store
from app.services.sip_dialer import sip_phone, preload_speech


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events"""
    # Startup: only one backend may run (two would dial everyone twice)
    try:
        instance_lock.acquire()
    except instance_lock.AlreadyRunning as e:
        logger.error(f"❌ {e}")
        raise
    logger.info("🚀 Starting AI Receptionist Hub...")
    await init_db()
    logger.info("✅ Database initialized")
    
    # Initialize AI Agent
    app.state.ai_agent = AIAgent()
    logger.info("✅ AI Agent initialized")
    
    # Initialize Call Manager
    app.state.call_manager = CallManager()
    logger.info("✅ Call Manager initialized")

    # Outbound dialer: places queued job calls (see app/services/outbound.py)
    outbound.conversation_factory = lambda call: make_conversation(app.state.ai_agent, call)
    dialer_stop = asyncio.Event()
    dialer_task = asyncio.create_task(outbound.dialer_loop(dialer_stop))
    logger.info("✅ Outbound dialer started")
    preload_speech()  # Vosk + Whisper load in the background, ready for the first call
    # Inbound line: registers the inbound extension and answers its calls
    inbound_line.start(app.state.ai_agent, asyncio.get_running_loop())

    yield

    # Shutdown
    dialer_stop.set()
    await dialer_task
    sip_phone.stop()  # unregister the SIP account, if one was registered
    inbound_line.stop()  # unregister the inbound extension
    instance_lock.release()
    logger.info("🛑 Shutting down AI Receptionist Hub...")


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    description="AI Receptionist & Automation Hub - Backend API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS: only the local dashboard (see app/core/security.py; add more
# dashboard URLs with APP_ALLOWED_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Added last so it runs first: the dashboard API answers only this computer
app.add_middleware(LocalOnlyMiddleware)
# Outermost: the website chat widget (/widget/...) is called from other websites
app.add_middleware(WidgetCorsMiddleware)

# Include API routes
app.include_router(agent_router, prefix="/api/agent", tags=["Agent"])
app.include_router(calls_router, prefix="/api/calls", tags=["Calls"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(webhooks_router, prefix="/webhooks", tags=["Webhooks"])
app.include_router(websocket_router, prefix="/ws", tags=["WebSocket"])
app.include_router(telephony_router, prefix="/api/telephony", tags=["Telephony"])
app.include_router(outbound_router, prefix="/api/outbound", tags=["Outbound Calls"])
app.include_router(voice_router, prefix="/webhooks/voice", tags=["Voice Webhooks"])
app.include_router(voice_engine_router, prefix="/api/voice", tags=["Live Voice"])
app.include_router(store_router, prefix="/api/store", tags=["Settings Store"])
app.include_router(chats_router, prefix="/api/chats", tags=["Text Simulator Chats"])
app.include_router(languages_router, prefix="/api/languages", tags=["Languages"])
app.include_router(ai_model_router, prefix="/api/ai-model", tags=["AI Model"])
app.include_router(call_rules_router, prefix="/api/call-rules", tags=["Call Rules"])
app.include_router(widget_admin_router, prefix="/api/widget", tags=["Website Chat"])
app.include_router(widget_public_router, prefix="/widget", tags=["Website Chat Widget (public)"])


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "online",
        "service": settings.APP_NAME,
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    """Detailed health check"""
    db = await asyncio.to_thread(store.status)
    return {
        "status": "healthy" if db["ok"] else "degraded",
        "database": "connected" if db["ok"] else f"error: {db.get('error')}",
        "ai_agent": "ready",
        "telephony": "configured"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=settings.APP_DEBUG
    )
