"""
AI Receptionist Hub - Main Application
FastAPI-based backend for AI-powered receptionist and automation
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.core.config import settings
from app.core.database import init_db
from app.api.routes import (
    agent_router,
    automation_router,
    calls_router,
    analytics_router,
    settings_router,
    webhooks_router,
    websocket_router
)
from app.services.ai_agent import AIAgent
from app.services.call_manager import CallManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events"""
    # Startup
    logger.info("🚀 Starting AI Receptionist Hub...")
    await init_db()
    logger.info("✅ Database initialized")
    
    # Initialize AI Agent
    app.state.ai_agent = AIAgent()
    logger.info("✅ AI Agent initialized")
    
    # Initialize Call Manager
    app.state.call_manager = CallManager()
    logger.info("✅ Call Manager initialized")
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down AI Receptionist Hub...")


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    description="AI Receptionist & Automation Hub - Backend API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(agent_router, prefix="/api/agent", tags=["Agent"])
app.include_router(automation_router, prefix="/api/automation", tags=["Automation"])
app.include_router(calls_router, prefix="/api/calls", tags=["Calls"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(settings_router, prefix="/api/settings", tags=["Settings"])
app.include_router(webhooks_router, prefix="/webhooks", tags=["Webhooks"])
app.include_router(websocket_router, prefix="/ws", tags=["WebSocket"])


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
    return {
        "status": "healthy",
        "database": "connected",
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
