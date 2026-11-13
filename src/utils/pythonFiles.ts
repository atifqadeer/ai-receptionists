/**
 * Python Backend Files - All files embedded as strings for zip download
 */

export const pythonFiles: Record<string, string> = {
  'main.py': `"""
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
    logger.info("🚀 Starting AI Receptionist Hub...")
    await init_db()
    logger.info("✅ Database initialized")
    
    app.state.ai_agent = AIAgent()
    logger.info("✅ AI Agent initialized")
    
    app.state.call_manager = CallManager()
    logger.info("✅ Call Manager initialized")
    
    yield
    
    logger.info("🛑 Shutting down AI Receptionist Hub...")


app = FastAPI(
    title=settings.APP_NAME,
    description="AI Receptionist & Automation Hub - Backend API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agent_router, prefix="/api/agent", tags=["Agent"])
app.include_router(automation_router, prefix="/api/automation", tags=["Automation"])
app.include_router(calls_router, prefix="/api/calls", tags=["Calls"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(settings_router, prefix="/api/settings", tags=["Settings"])
app.include_router(webhooks_router, prefix="/webhooks", tags=["Webhooks"])
app.include_router(websocket_router, prefix="/ws", tags=["WebSocket"])


@app.get("/")
async def root():
    return {
        "status": "online",
        "service": settings.APP_NAME,
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
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
`,

  'requirements.txt': `# AI Receptionist Hub - Core Dependencies
fastapi==0.109.0
uvicorn[standard]==0.27.0
python-multipart==0.0.6
python-dotenv==1.0.0
pydantic==2.5.3
pydantic-settings==2.1.0
openai==1.12.0
sqlalchemy==2.0.25
aiosqlite==0.19.0
httpx==0.26.0
loguru==0.7.2
websockets==12.0
pytest==7.4.4
pytest-asyncio==0.23.3
`,

  '.env.example': `# ============================================
# AI Receptionist - Environment Configuration
# ============================================
# 
# 📋 HOW TO USE THIS FILE:
# 1. Copy this file: cp .env.example .env
# 2. Edit .env with your actual API keys
# 3. Choose DEVELOPMENT or PRODUCTION section below
#
# 🔑 API KEYS GUIDE:
# - Development keys = For testing (cheap/free)
# - Production keys = For live use (real charges)
# - See API_KEYS_GUIDE.md for full details
#
# ============================================


# ============================================
# 🧪 DEVELOPMENT CONFIGURATION
# ============================================
# Use this section for local testing & development
# Cost: ~$5-10/month (very affordable)

APP_ENV=development
APP_DEBUG=true
APP_HOST=0.0.0.0
APP_PORT=8000
APP_SECRET_KEY=dev-secret-key-change-in-production

# Database (SQLite - simple for dev)
DATABASE_URL=sqlite+aiosqlite:///./data/ai_receptionist.db

# OpenAI (REQUIRED - use cheaper GPT-3.5 for dev)
# Get key: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-3.5-turbo
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_TOKENS=500

# Twilio (OPTIONAL - use TEST credentials, no real calls)
# Get test keys: https://console.twilio.com → Test Credentials
TWILIO_ACCOUNT_SID=ACyour_test_account_sid
TWILIO_AUTH_TOKEN=your_test_auth_token
TWILIO_PHONE_NUMBER=+15005550006
TWILIO_WEBHOOK_URL=http://localhost:8000/webhooks/twilio

# ElevenLabs (OPTIONAL - free tier: 10k chars/month)
# Get key: https://elevenlabs.io/ (free signup)
ELEVENLABS_API_KEY=your_free_tier_key
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM

# Deepgram (OPTIONAL - free $200 credit)
# Get key: https://console.deepgram.com/ (free signup)
DEEPGRAM_API_KEY=your_free_credit_key


# ============================================
# 🚀 PRODUCTION CONFIGURATION
# ============================================
# Uncomment this section and comment out the dev section above
# when deploying to production with real customers
# Cost: ~$60-200/month (depends on usage)

# APP_ENV=production
# APP_DEBUG=false
# APP_HOST=0.0.0.0
# APP_PORT=8000
# APP_SECRET_KEY=CHANGE-THIS-TO-A-STRONG-RANDOM-KEY
# 
# # Database (PostgreSQL - robust for production)
# DATABASE_URL=postgresql://user:password@localhost:5432/ai_receptionist
# 
# # OpenAI (REQUIRED - use GPT-4 for best quality)
# # Get key: https://platform.openai.com/api-keys
# # IMPORTANT: Set spending limits!
# OPENAI_API_KEY=sk-your-live-api-key
# OPENAI_MODEL=gpt-4-turbo
# OPENAI_TEMPERATURE=0.7
# OPENAI_MAX_TOKENS=500
# 
# # Twilio (LIVE credentials - real phone calls)
# # Get keys: https://console.twilio.com → Live Credentials
# # IMPORTANT: Real charges apply!
# TWILIO_ACCOUNT_SID=ACyour_live_account_sid
# TWILIO_AUTH_TOKEN=your_live_auth_token
# TWILIO_PHONE_NUMBER=+1234567890
# TWILIO_WEBHOOK_URL=https://yourdomain.com/webhooks/twilio
# 
# # ElevenLabs (PAID plan - commercial use)
# # Get key: https://elevenlabs.io/app/subscription
# ELEVENLABS_API_KEY=your_paid_plan_key
# ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
# 
# # Deepgram (PAID plan - production use)
# # Get key: https://console.deepgram.com/
# DEEPGRAM_API_KEY=your_paid_plan_key


# ============================================
# 🔐 SECURITY SETTINGS (Both Environments)
# ============================================

# JWT Authentication
JWT_SECRET_KEY=your-jwt-secret-key-make-this-random
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30

# Redis (Optional - for caching & queues)
REDIS_URL=redis://localhost:6379/0

# Google Calendar (Optional)
GOOGLE_CALENDAR_CREDENTIALS_PATH=./credentials/google-calendar.json
GOOGLE_CALENDAR_ID=primary

# Slack Notifications (Optional)
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_CHANNEL_ID=C0123456789

# SendGrid Email (Optional)
SENDGRID_API_KEY=SG.your-sendgrid-api-key
SENDGRID_FROM_EMAIL=receptionist@yourcompany.com
`,

  '.gitignore': `# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
venv/
env/
ENV/
*.egg-info/
dist/
build/

# Environment
.env
.env.local

# Database
*.db
*.sqlite
*.sqlite3

# IDE
.vscode/
.idea/
*.swp
*.swo

# Logs
logs/
*.log

# OS
.DS_Store
Thumbs.db

# Credentials
credentials/
*.pem
*.key

# Data
data/
`,

  'setup.sh': `#!/bin/bash
echo "🤖 AI Receptionist Hub - Local Setup"
echo "======================================"

python_version=$(python3 --version 2>&1)
if [ $? -eq 0 ]; then
    echo "✅ $python_version"
else
    echo "❌ Python 3 not found. Please install Python 3.9+"
    exit 1
fi

echo "🔧 Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate
echo "✅ Virtual environment created"

echo "📦 Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
echo "✅ Dependencies installed"

if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ .env file created"
    echo "⚠️  Edit .env and add your OPENAI_API_KEY"
fi

mkdir -p data logs credentials
echo "✅ Directories created"

echo ""
echo "🎉 Setup Complete!"
echo "Run: python main.py"
`,

  'setup.bat': `@echo off
echo.
echo  =========================================
echo   AI Receptionist Hub - Windows Setup
echo  =========================================

python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found
    pause
    exit /b 1
)

python -m venv venv
call venv\\Scripts\\activate.bat

pip install --upgrade pip
pip install -r requirements.txt

if not exist .env (
    copy .env.example .env
    echo  Created .env file
)

if not exist data mkdir data
if not exist logs mkdir logs
if not exist credentials mkdir credentials

echo.
echo  Setup Complete!
echo  Run: python main.py
pause
`,

  'start.py': `#!/usr/bin/env python3
"""Quick Start Script"""

import os
import sys
import subprocess
import time
import webbrowser

def check_python():
    if sys.version_info < (3, 9):
        print("❌ Python 3.9+ required")
        sys.exit(1)
    print(f"✅ Python {sys.version_info.major}.{sys.version_info.minor}")

def check_env():
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if not os.path.exists(env_path):
        example_path = os.path.join(os.path.dirname(__file__), '.env.example')
        if os.path.exists(example_path):
            import shutil
            shutil.copy(example_path, env_path)
            print("✅ Created .env from .env.example")
            print("\\n⚠️  Edit .env and add your OPENAI_API_KEY!")
            input("\\nPress Enter after adding your API key...")

def install_deps():
    print("\\n📦 Installing dependencies...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "-q"])
    print("✅ Dependencies installed")

def init_db():
    print("\\n🗄️  Initializing database...")
    try:
        from app.core.database import init_db
        import asyncio
        asyncio.run(init_db())
        print("✅ Database ready")
    except Exception as e:
        print(f"⚠️  Database init skipped: {e}")

def start_server():
    print("\\n🚀 Starting AI Receptionist Hub...")
    print("=" * 50)
    print("  📡 API:       http://localhost:8000")
    print("  📖 API Docs:  http://localhost:8000/docs")
    print("=" * 50)
    
    time.sleep(2)
    webbrowser.open("http://localhost:8000/docs")
    
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

def main():
    print("\\n🤖 AI Receptionist Hub - Quick Start")
    print("=" * 40)
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    check_python()
    check_env()
    install_deps()
    init_db()
    start_server()

if __name__ == "__main__":
    main()
`,

  'test_setup.py': `#!/usr/bin/env python3
"""Test Script - Verify your setup"""

import os
import sys

def test_python_version():
    print("1. Testing Python version...", end=" ")
    if sys.version_info >= (3, 9):
        print(f"✅ Python {sys.version_info.major}.{sys.version_info.minor}")
        return True
    print(f"❌ Need Python 3.9+")
    return False

def test_dependencies():
    print("2. Testing dependencies...", end=" ")
    packages = ['fastapi', 'uvicorn', 'openai', 'pydantic', 'sqlalchemy', 'httpx', 'loguru']
    missing = []
    for pkg in packages:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if not missing:
        print("✅ All dependencies installed")
        return True
    print(f"❌ Missing: {', '.join(missing)}")
    return False

def test_env_file():
    print("3. Testing environment...", end=" ")
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if not os.path.exists(env_path):
        print("❌ .env not found")
        return False
    from dotenv import load_dotenv
    load_dotenv(env_path)
    key = os.getenv("OPENAI_API_KEY", "")
    if not key or key == "sk-your-openai-api-key-here":
        print("⚠️  OPENAI_API_KEY not set")
        return False
    print("✅ Environment configured")
    return True

def test_imports():
    print("4. Testing app imports...", end=" ")
    try:
        from app.core.config import settings
        from app.models.schemas import AgentConfig
        from app.services.ai_agent import AIAgent
        print("✅ All modules importable")
        return True
    except Exception as e:
        print(f"❌ Import error: {e}")
        return False

def main():
    print("\\n🧪 AI Receptionist Hub - Setup Verification")
    print("=" * 50)
    results = [test_python_version(), test_dependencies(), test_env_file(), test_imports()]
    print("\\n" + "=" * 50)
    passed = sum(results)
    if passed == len(results):
        print(f"🎉 All tests passed! ({passed}/{len(results)})")
        print("\\nRun: python main.py")
    else:
        print(f"⚠️  {passed}/{len(results)} tests passed")

if __name__ == "__main__":
    main()
`,

  'README.md': `# 🤖 AI Receptionist & Automation Hub - Python Backend

## Quick Start

\`\`\`bash
# 1. Install Python 3.9+ and create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\\Scripts\\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# 4. Start the server
python main.py

# 5. Open API docs
# http://localhost:8000/docs
\`\`\`

## Features

- AI-powered receptionist with OpenAI integration
- Real-time call handling via WebSocket
- Twilio integration for phone calls
- Automation rules and workflows
- Analytics and reporting
- Team management

## API Documentation

Visit http://localhost:8000/docs when the server is running.

## Configuration

Edit \`.env\` file with your API keys:
- OPENAI_API_KEY (required)
- TWILIO_ACCOUNT_SID (optional, for phone calls)
- ELEVENLABS_API_KEY (optional, for voice)
- DEEPGRAM_API_KEY (optional, for speech recognition)

## Project Structure

\`\`\`
app/
├── core/          # Configuration and database
├── models/        # Pydantic schemas
├── services/      # AI agent and call manager
└── api/           # API routes
\`\`\`
`,

  'QUICKSTART.md': `# 🚀 QUICK START GUIDE

## Step 1: Install Prerequisites
- Python 3.9+: https://www.python.org/downloads/
- Verify: \`python --version\`

## Step 2: Get OpenAI API Key
1. Go to https://platform.openai.com/api-keys
2. Create a new secret key
3. Copy the key (starts with \`sk-...\`)

## Step 3: Set Up Backend
\`\`\`bash
cd ai-receptionist-python-backend
python -m venv venv

# Windows:
venv\\Scripts\\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
\`\`\`

## Step 4: Configure API Keys
\`\`\`bash
cp .env.example .env
# Edit .env and add: OPENAI_API_KEY=sk-your-key
\`\`\`

## Step 5: Start Server
\`\`\`bash
python main.py
\`\`\`

## Step 6: Open Browser
- API: http://localhost:8000
- Docs: http://localhost:8000/docs

## Troubleshooting

**"Python not found"**: Install Python and check "Add to PATH"
**"Module not found"**: Run \`pip install -r requirements.txt\`
**"Port 8000 in use"**: Change APP_PORT in .env
**"API key not set"**: Edit .env and add your OPENAI_API_KEY
`,

  'app/__init__.py': `# AI Receptionist Hub - Python Backend
`,

  'app/core/__init__.py': `# Core module
`,

  'app/core/config.py': `"""
Core Configuration - Loads environment variables and settings
"""

import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

# Load .env file
load_dotenv()


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    # App Settings
    APP_NAME: str = os.getenv("APP_NAME", "AI Receptionist Hub")
    APP_ENV: str = os.getenv("APP_ENV", "development")
    APP_DEBUG: bool = os.getenv("APP_DEBUG", "true").lower() == "true"
    APP_HOST: str = os.getenv("APP_HOST", "0.0.0.0")
    APP_PORT: int = int(os.getenv("APP_PORT", "8000"))
    APP_SECRET_KEY: str = os.getenv("APP_SECRET_KEY", "dev-secret-key-change-in-production")
    
    # Database (must be the async aiosqlite form — the old sync default
    # made create_async_engine raise on startup when no .env was present)
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/ai_receptionist.db")
    
    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # OpenAI
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4-turbo-preview")
    OPENAI_TEMPERATURE: float = float(os.getenv("OPENAI_TEMPERATURE", "0.7"))
    OPENAI_MAX_TOKENS: int = int(os.getenv("OPENAI_MAX_TOKENS", "500"))
    
    # ElevenLabs TTS
    ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")
    ELEVENLABS_VOICE_ID: str = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    
    # Deepgram STT
    DEEPGRAM_API_KEY: str = os.getenv("DEEPGRAM_API_KEY", "")
    
    # Twilio
    TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_PHONE_NUMBER: str = os.getenv("TWILIO_PHONE_NUMBER", "")
    TWILIO_WEBHOOK_URL: str = os.getenv("TWILIO_WEBHOOK_URL", "http://localhost:8000/webhooks/twilio")
    
    # JWT
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "jwt-secret-key")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    
    # extra="ignore": the shipped .env.example carries keys for optional
    # integrations (SENDGRID_*, SLACK_*, GOOGLE_CALENDAR_*). With the old
    # inner-Config setup those undeclared keys crashed startup with
    # "Extra inputs are not permitted".
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")


settings = Settings()
`,

  'app/core/database.py': `"""
Database Setup - SQLAlchemy async models and initialization
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# Create async engine
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_DEBUG,
)

# Create session factory
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    """Base class for all database models"""
    pass


async def init_db():
    """Initialize database tables"""
    # A sqlite file URL like sqlite+aiosqlite:///./data/x.db fails to
    # open if the parent folder does not exist yet — create it.
    url = settings.DATABASE_URL
    if url.startswith("sqlite") and ":///" in url:
        from pathlib import Path
        db_path = Path(url.split(":///", 1)[1])
        if not db_path.is_absolute():
            db_path = Path.cwd() / db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """Dependency to get database session"""
    async with async_session() as session:
        yield session
`,

  'app/models/__init__.py': `# Models module
`,

  'app/models/schemas.py': `"""
Pydantic schemas for request/response models
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class CallStatus(str, Enum):
    RINGING = "ringing"
    ACTIVE = "active"
    ON_HOLD = "on_hold"
    TRANSFERRING = "transferring"
    ENDED = "ended"
    MISSED = "missed"


class IntentType(str, Enum):
    APPOINTMENT_BOOKING = "appointment_booking"
    BUSINESS_HOURS = "business_hours"
    GENERAL_INQUIRY = "general_inquiry"
    TECHNICAL_SUPPORT = "technical_support"
    COMPLAINT = "complaint"
    TRANSFER_REQUEST = "transfer_request"
    PRICING = "pricing"
    OTHER = "other"
    ERROR = "error"


class Personality(str, Enum):
    PROFESSIONAL = "professional"
    FRIENDLY = "friendly"
    CASUAL = "casual"
    EMPATHETIC = "empathetic"


# ---- Agent Config ----
class KnowledgeBase(BaseModel):
    business_hours: str = "Monday to Friday, 9:00 AM to 6:00 PM EST"
    address: str = ""
    phone: str = ""
    email: str = ""
    services: str = ""


class FAQ(BaseModel):
    question: str
    answer: str


class AgentConfig(BaseModel):
    agent_name: str = "Aria"
    company_name: str = "TechCorp Solutions"
    language: str = "English"
    voice: str = "skylar"
    speaking_rate: float = 1.0
    pitch: float = 1.0
    greeting: str = "Hello! Thank you for calling. How can I help you today?"
    farewell: str = "Thank you for calling! Have a wonderful day."
    personality: str = "professional"
    max_call_duration: int = 15
    silence_timeout: int = 8
    allow_interrupts: bool = True
    knowledge_base: Dict[str, str] = {}
    faqs: List[Dict[str, str]] = []
    # Uploaded knowledge documents (.md/.txt files from Agent Setup).
    # Each item: {"name": filename, "content": full text of the file}.
    # The agent answers from these together with knowledge_base.
    knowledge_documents: List[Dict[str, str]] = []


# ---- Call Models ----
class CallContext(BaseModel):
    call_id: str
    caller_number: Optional[str] = None
    caller_name: Optional[str] = None
    status: CallStatus = CallStatus.ACTIVE
    started_at: datetime = Field(default_factory=datetime.utcnow)
    duration_seconds: int = 0


class Message(BaseModel):
    id: str
    sender: str  # "agent", "caller", "system"
    text: str
    timestamp: str
    intent: Optional[str] = None


class AgentResponse(BaseModel):
    message: str
    intent: str = "other"
    confidence: float = 0.0
    call_id: str
    timestamp: str
    requires_action: bool = False
    action_data: Dict[str, Any] = {}


# ---- Automation Models ----
class AutomationRule(BaseModel):
    id: int
    name: str
    trigger: str
    action: str
    enabled: bool = True
    priority: int = 1


class Workflow(BaseModel):
    id: int
    name: str
    steps: int
    status: str = "active"
    calls: int = 0


# ---- Analytics Models ----
class CallLog(BaseModel):
    id: str
    caller: str
    number: str
    time: str
    duration: str
    status: str
    intent: str
    satisfaction: int = 0


class DashboardStats(BaseModel):
    total_calls: int = 0
    calls_handled: int = 0
    avg_response_time: float = 0.0
    satisfaction_rate: float = 0.0
    resolution_rate: float = 0.0
    transfer_rate: float = 0.0


# ---- Settings Models ----
class TelephonyConfig(BaseModel):
    provider: str = "twilio"
    account_sid: str = ""
    auth_token: str = ""
    phone_number: str = ""
    webhook_url: str = ""
    max_concurrent_calls: int = 10
    enable_sip: bool = False


class AIModelConfig(BaseModel):
    provider: str = "openai"
    model: str = "gpt-4-turbo-preview"
    api_key: str = ""
    temperature: float = 0.7
    max_tokens: int = 500
    system_prompt: str = ""
    enable_function_calling: bool = True
    enable_memory: bool = True


class TeamMember(BaseModel):
    id: int
    name: str
    role: str
    email: str
    status: str = "active"


# ---- WebSocket Models ----
class WSMessage(BaseModel):
    type: str  # "text", "audio", "intent", "status", "error"
    data: Dict[str, Any] = {}
    call_id: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())`,

  'app/services/__init__.py': `# Services module
`,

  'app/services/ai_agent.py': `"""
AI Agent Service - Core AI receptionist logic using OpenAI/Anthropic
"""

import json
import re
from pathlib import Path
from typing import AsyncGenerator, Optional
from datetime import datetime
from loguru import logger
from openai import AsyncOpenAI

from app.core.config import settings
from app.models.schemas import (
    AgentConfig, CallContext, Message, AgentResponse
)

# The agent's configuration (identity + knowledge base + FAQs) is the
# single source the agent answers from. It is persisted to disk so the
# knowledge base set in the dashboard survives restarts — previously it
# lived only in memory and reset to the hardcoded defaults on restart.
_CONFIG_FILE = Path(__file__).resolve().parents[2] / "data" / "agent_config.json"

_STOPWORDS = {
    "what", "when", "where", "which", "your", "yours", "about", "there",
    "their", "this", "that", "with", "have", "does", "did", "will",
    "would", "could", "should", "please", "thanks", "thank",
}


class AIAgent:
    """
    AI Receptionist Agent
    Handles conversation logic, intent detection, and response generation
    """
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.config = self._load_config()
        self.conversation_history: dict[str, list[dict]] = {}

    def _load_config(self) -> AgentConfig:
        """Load the persisted config if present, else the defaults."""
        try:
            if _CONFIG_FILE.exists():
                data = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
                logger.info(f"Agent config loaded from {_CONFIG_FILE}")
                return AgentConfig.model_validate(data)
        except Exception as e:
            logger.warning(f"Could not load saved agent config ({e}); using defaults")
        return self._load_default_config()

    def _save_config(self) -> None:
        """Persist the current config (knowledge base included)."""
        try:
            _CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            _CONFIG_FILE.write_text(
                json.dumps(self.config.model_dump(), indent=2), encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"Could not save agent config: {e}")

    def _load_default_config(self) -> AgentConfig:
        """Load default agent configuration"""
        return AgentConfig(
            agent_name="Aria",
            company_name="TechCorp Solutions",
            language="English",
            voice="skylar",
            speaking_rate=1.0,
            pitch=1.0,
            greeting="Hello! Thank you for calling TechCorp Solutions. I'm Aria, your AI assistant. How can I help you today?",
            farewell="Thank you for calling! Have a wonderful day.",
            personality="professional",
            max_call_duration=15,
            silence_timeout=8,
            allow_interrupts=True,
            knowledge_base={
                "business_hours": "Monday to Friday, 9:00 AM to 6:00 PM EST",
                "address": "123 Innovation Drive, Suite 400, San Francisco, CA 94102",
                "phone": "+1 (555) 123-4567",
                "email": "support@techcorp.com",
                "services": "Web Development, Mobile Apps, Cloud Solutions, AI Integration",
                # Free-form company knowledge, written in Agent Setup >
                # Knowledge Base. Structure: one fact per line (or a short
                # paragraph per topic, blank line between topics). The
                # agent answers company questions from this text: it is
                # searched passage-by-passage before the AI model is used,
                # and it is also given to the model verbatim in the prompt.
                "company_info": (
                    "TechCorp Solutions is a software company based in San Francisco, California.\\n"
                    "We build web applications, mobile apps, cloud solutions and AI integrations for startups and enterprises.\\n"
                    "Our team has more than 40 engineers, designers and project managers.\\n"
                    "We offer a free 30-minute consultation for every new project.\\n"
                    "A basic business website starts at $2,500; full project pricing depends on the scope.\\n"
                    "Every project includes 3 months of free support after launch.\\n"
                    "To start a project, email support@techcorp.com or call +1 (555) 123-4567."
                )
            },
            faqs=[
                {"question": "What are your business hours?", "answer": "We are open Monday to Friday, 9 AM to 6 PM EST."},
                {"question": "How do I book an appointment?", "answer": "I can help you book an appointment right now. What date and time works best for you?"},
                {"question": "What services do you offer?", "answer": "We offer web development, mobile apps, cloud solutions, and AI integration services."},
            ]
        )
    
    def _build_system_prompt(self) -> str:
        """Build the system prompt for the AI agent"""
        config = self.config
        kb = config.knowledge_base
        
        return f"""You are {config.agent_name}, a professional and friendly AI receptionist for {config.company_name}.

YOUR ROLE:
- Answer incoming calls professionally
- Help callers with appointments, inquiries, and general information
- Route complex issues to human agents when needed
- Maintain a {config.personality} tone throughout the conversation

BUSINESS INFORMATION:
- Business Hours: {kb.get('business_hours', 'N/A')}
- Address: {kb.get('address', 'N/A')}
- Phone: {kb.get('phone', 'N/A')}
- Email: {kb.get('email', 'N/A')}
- Services: {kb.get('services', 'N/A')}

FAQs:
{chr(10).join([f"- Q: {faq['question']} A: {faq['answer']}" for faq in config.faqs])}

COMPANY KNOWLEDGE (the main source for questions about the company — its history, policies, prices, delivery, warranty and anything else written here):
{kb.get('company_info', '') or 'N/A'}

KNOWLEDGE DOCUMENTS (uploaded files; answer from them exactly as from the company knowledge above):
{chr(10).join([f"--- {d.get('name', 'document')} ---" + chr(10) + (d.get('content') or '') for d in config.knowledge_documents]) or 'None uploaded.'}

RULES:
1. Always greet the caller warmly
2. Listen carefully and identify the caller's intent
3. KNOWLEDGE BASE ONLY: answer questions using ONLY the BUSINESS INFORMATION and FAQs above. If the answer is not in that data, say you don't have that information and offer to connect the caller with the team — never invent hours, prices, addresses, policies or services.
4. If you can't help, offer to transfer to a human agent
5. Keep responses concise and conversational (suitable for voice)
6. Never make up information you don't have
7. Always confirm important details (appointments, contact info)
8. End calls politely

RESPONSE FORMAT:
Respond in a natural, conversational way. Keep responses under 3 sentences when possible.
When you detect an intent, include it in your response.

AVAILABLE INTENTS:
- appointment_booking: Caller wants to schedule an appointment
- business_hours: Caller asking about operating hours
- general_inquiry: General questions about the company
- technical_support: Caller needs technical help
- complaint: Caller has a complaint
- transfer_request: Caller wants to speak to a human
- pricing: Caller asking about prices/services
- other: Anything else
"""

    async def process_message(
        self,
        call_id: str,
        user_message: str,
        context: Optional[CallContext] = None
    ) -> AgentResponse:
        """
        Process a caller's message and generate a response
        
        Args:
            call_id: Unique call identifier
            user_message: The caller's message (transcribed from speech)
            context: Additional call context
            
        Returns:
            AgentResponse with the agent's reply and detected intent
        """
        # Initialize conversation history for new calls
        if call_id not in self.conversation_history:
            self.conversation_history[call_id] = [
                {"role": "system", "content": self._build_system_prompt()}
            ]
            logger.info(f"New call started: {call_id}")
        
        # Add user message to history
        self.conversation_history[call_id].append({
            "role": "user",
            "content": user_message
        })

        # Knowledge base first: if the caller's question matches a
        # configured FAQ or asks for a stored business fact, answer
        # verbatim from the knowledge base. Chat and phone calls both
        # come through here, so both speak from the same data — and
        # these answers work even when the AI provider is unavailable.
        kb_hit = self._kb_lookup(user_message)
        if kb_hit is not None:
            answer, intent = kb_hit
            self.conversation_history[call_id].append({
                "role": "assistant",
                "content": answer
            })
            logger.info(f"Call {call_id} - answered from knowledge base (intent: {intent})")
            return AgentResponse(
                message=answer,
                intent=intent,
                confidence=1.0,
                call_id=call_id,
                timestamp=datetime.utcnow().isoformat(),
                requires_action=self._check_requires_action(intent),
                action_data=self._get_action_data(intent, user_message)
            )

        try:
            # Call OpenAI API
            response = await self.client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=self.conversation_history[call_id],
                temperature=settings.OPENAI_TEMPERATURE,
                max_tokens=settings.OPENAI_MAX_TOKENS,
            )
            
            agent_message = response.choices[0].message.content
            
            # Add agent response to history
            self.conversation_history[call_id].append({
                "role": "assistant",
                "content": agent_message
            })
            
            # Detect intent from the conversation
            intent = await self._detect_intent(call_id, user_message)
            
            logger.info(f"Call {call_id} - Intent: {intent} | Response: {agent_message[:50]}...")
            
            return AgentResponse(
                message=agent_message,
                intent=intent,
                confidence=0.95,
                call_id=call_id,
                timestamp=datetime.utcnow().isoformat(),
                requires_action=self._check_requires_action(intent),
                action_data=self._get_action_data(intent, user_message)
            )
            
        except Exception as e:
            logger.error(f"Error processing message for call {call_id}: {e}")
            return AgentResponse(
                message="I'm sorry, I'm having trouble processing your request right now. Let me connect you with someone who can help.",
                intent="error",
                confidence=0.0,
                call_id=call_id,
                timestamp=datetime.utcnow().isoformat(),
                requires_action=True,
                action_data={"action": "transfer_to_human"}
            )
    
    @staticmethod
    def _significant_words(text: str) -> set:
        words = set()
        for w in re.findall(r"[a-z0-9]+", text.lower()):
            if len(w) <= 3 or w in _STOPWORDS:
                continue
            # Light stemming so "deliver" matches "delivery"-style plurals
            # and simple plural forms ("charges" -> "charge").
            if len(w) > 4 and w.endswith("s"):
                w = w[:-1]
            words.add(w)
        return words

    @staticmethod
    def _kb_passages(text: str) -> list:
        """Split free-form company knowledge into searchable passages.

        Structure the agent reads: one fact per line; a long line is
        split into its sentences; blank lines separate topics. Markdown
        is cleaned so answers read as plain speech: heading markers,
        bold markers, bullets and table pipes are removed, and table
        separator rows are dropped.
        """
        def clean(line: str) -> str:
            line = re.sub(r"^#+\\s*", "", line.strip())   # heading markers
            line = re.sub(r"^\\s*>\\s?", "", line)         # quote marker
            line = line.strip(" \\t-•*")
            return line.replace("**", "").replace("__", "").strip()

        def cells(line: str) -> list:
            return [c.strip() for c in line.strip().strip("|").split("|") if c.strip()]

        lines = (text or "").splitlines()
        passages = []
        i = 0
        while i < len(lines):
            raw = lines[i]
            # Markdown table: a header row followed by a |---|---| row.
            # Each data row becomes "Header: value. Header: value." so a
            # question naming either column can match and be answered.
            if "|" in raw and i + 1 < len(lines) and "-" in lines[i + 1] and re.fullmatch(r"[|:\\-\\s]+", lines[i + 1].strip()):
                header = [clean(c) for c in cells(raw)]
                i += 2
                while i < len(lines) and "|" in lines[i]:
                    row = [clean(c) for c in cells(lines[i])]
                    if header and len(row) == len(header):
                        passages.append(". ".join(f"{h}: {c}" for h, c in zip(header, row)) + ".")
                    elif row:
                        passages.append(" — ".join(row))
                    i += 1
                continue
            line = raw.strip()
            i += 1
            if not line or re.fullmatch(r"[|:\\-\\s]+", line):
                continue  # blank, table separator row or horizontal rule
            line = clean(line)
            if "|" in line:                              # stray table row
                line = re.sub(r"\\s*\\|\\s*", " — ", line).strip(" —")
            if not line:
                continue
            if len(line) > 220:
                parts = re.split(r"(?<=[.!?])\\s+", line)
                passages.extend(p.strip() for p in parts if len(p.strip()) > 15)
            else:
                passages.append(line)
        return passages

    def _knowledge_sources(self) -> list:
        """All free-form knowledge the agent answers from, in order:
        the Company Knowledge text first, then each uploaded document."""
        kb = self.config.knowledge_base or {}
        sources = []
        info = (kb.get("company_info") or "").strip()
        if info:
            sources.append(info)
        for doc in self.config.knowledge_documents or []:
            content = (doc.get("content") or "").strip()
            if content:
                sources.append(content)
        return sources

    def _company_info_lookup(self, message: str, msg_words: set) -> Optional[tuple]:
        """Answer from the free-form company knowledge — the Company
        Knowledge text plus every uploaded knowledge document."""
        passages = []
        for source in self._knowledge_sources():
            passages.extend(self._kb_passages(source))
        if not passages:
            return None

        lower = message.lower()
        # "Tell me about your company" style questions get the overview:
        # the first passage(s) of the knowledge text.
        if ("about" in lower and ("company" in lower or "business" in lower)) or \\
           "who are you" in lower or "your company" in lower or "your business" in lower:
            overview = passages[0]
            if len(passages) > 1 and len(overview) < 160:
                overview = overview + " " + passages[1]
            return overview, "general_inquiry"

        if not msg_words:
            return None
        best, best_shared = None, 0
        for passage in passages:
            shared = len(self._significant_words(passage) & msg_words)
            if shared > best_shared:
                best, best_shared = passage, shared
        # Accept a passage when at least two of the caller's key words
        # appear in it and they cover at least half of those key words
        # (a single key word must match exactly).
        needed = 1 if len(msg_words) == 1 else 2
        if best is not None and best_shared >= needed and best_shared * 2 >= len(msg_words):
            return best, "general_inquiry"
        return None

    def _kb_lookup(self, message: str) -> Optional[tuple]:
        """
        Match the caller's message against the knowledge base.

        Returns (answer, intent) when an FAQ matches or the message asks
        for a stored business fact (hours, address, phone, email,
        services); otherwise None so the AI model handles it — grounded
        by the same knowledge base in its system prompt.
        """
        lower = message.lower()
        msg_words = self._significant_words(message)

        # 1) FAQs: match on the FAQ question's significant words.
        for faq in self.config.faqs or []:
            question = (faq.get("question") or "").strip()
            answer = (faq.get("answer") or "").strip()
            if not question or not answer:
                continue
            q_words = self._significant_words(question)
            if not q_words:
                continue
            shared = len(q_words & msg_words)
            if shared >= min(2, len(q_words)):
                return answer, "general_inquiry"

        # 2) Stored business facts.
        kb = self.config.knowledge_base or {}

        def fact(key: str) -> str:
            return (kb.get(key) or "").strip()

        if any(w in lower for w in ("hour", "open", "close", "timing")) and fact("business_hours"):
            return f"Our business hours are {fact('business_hours')}.", "business_hours"
        if any(w in lower for w in ("where", "address", "location", "located", "direction")) and fact("address"):
            return f"We are located at {fact('address')}.", "general_inquiry"
        if any(w in lower for w in ("phone", "number", "contact")) and fact("phone"):
            return f"You can reach us at {fact('phone')}.", "general_inquiry"
        if "email" in lower and fact("email"):
            return f"Our email address is {fact('email')}.", "general_inquiry"
        if any(w in lower for w in ("service", "offer", "provide")) and fact("services"):
            return f"We offer {fact('services')}.", "general_inquiry"
        # 3) Free-form company knowledge written in Agent Setup: any
        # other company question is answered from that text.
        return self._company_info_lookup(message, msg_words)

    async def _detect_intent(self, call_id: str, message: str) -> str:
        """Detect the caller's intent from their message"""
        intent_prompt = f"""Analyze this caller message and return ONLY the intent category.
        
Message: "{message}"

Categories: appointment_booking, business_hours, general_inquiry, technical_support, complaint, transfer_request, pricing, other

Return only the category name, nothing else."""

        try:
            response = await self.client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": intent_prompt}],
                temperature=0.1,
                max_tokens=20
            )
            intent = response.choices[0].message.content.strip().lower()
            valid_intents = [
                "appointment_booking", "business_hours", "general_inquiry",
                "technical_support", "complaint", "transfer_request", "pricing", "other"
            ]
            return intent if intent in valid_intents else "other"
        except Exception:
            return "other"
    
    def _check_requires_action(self, intent: str) -> bool:
        """Check if the detected intent requires an automated action"""
        action_intents = [
            "appointment_booking", "transfer_request", "complaint"
        ]
        return intent in action_intents
    
    def _get_action_data(self, intent: str, message: str) -> dict:
        """Get action data based on detected intent"""
        actions = {
            "appointment_booking": {"action": "collect_appointment_details"},
            "transfer_request": {"action": "transfer_to_human"},
            "complaint": {"action": "create_support_ticket"},
        }
        return actions.get(intent, {"action": "none"})
    
    async def stream_response(
        self,
        call_id: str,
        user_message: str
    ) -> AsyncGenerator[str, None]:
        """Stream the agent's response token by token"""
        if call_id not in self.conversation_history:
            self.conversation_history[call_id] = [
                {"role": "system", "content": self._build_system_prompt()}
            ]
        
        self.conversation_history[call_id].append({
            "role": "user",
            "content": user_message
        })
        
        stream = await self.client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=self.conversation_history[call_id],
            temperature=settings.OPENAI_TEMPERATURE,
            max_tokens=settings.OPENAI_MAX_TOKENS,
            stream=True
        )
        
        full_response = ""
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                token = chunk.choices[0].delta.content
                full_response += token
                yield token
        
        # Save complete response to history
        self.conversation_history[call_id].append({
            "role": "assistant",
            "content": full_response
        })
    
    def end_call(self, call_id: str) -> dict:
        """End a call and return summary"""
        history = self.conversation_history.pop(call_id, [])
        return {
            "call_id": call_id,
            "messages_count": len(history),
            "ended_at": datetime.utcnow().isoformat(),
            "summary": "Call ended successfully"
        }
    
    def update_config(self, config_data: dict) -> AgentConfig:
        """Update agent configuration and persist it to disk"""
        for key, value in config_data.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)
        self._save_config()
        logger.info("Agent configuration updated and saved")
        return self.config
    
    def get_config(self) -> AgentConfig:
        """Get current agent configuration"""
        return self.config

    # ---- Knowledge documents (.md/.txt uploads from Agent Setup) ----

    def list_knowledge_documents(self) -> list:
        """Uploaded knowledge documents (names and sizes, not content)."""
        return [
            {"name": d.get("name", ""), "characters": len(d.get("content") or "")}
            for d in self.config.knowledge_documents or []
        ]

    def add_knowledge_document(self, name: str, content: str) -> list:
        """Add or replace an uploaded knowledge document and persist it."""
        docs = [d for d in self.config.knowledge_documents or [] if d.get("name") != name]
        docs.append({"name": name, "content": content})
        self.config.knowledge_documents = docs
        self._save_config()
        logger.info(f"Knowledge document saved: {name} ({len(content)} chars)")
        return self.list_knowledge_documents()

    def remove_knowledge_document(self, name: str) -> bool:
        """Remove an uploaded knowledge document by file name."""
        docs = self.config.knowledge_documents or []
        kept = [d for d in docs if d.get("name") != name]
        if len(kept) == len(docs):
            return False
        self.config.knowledge_documents = kept
        self._save_config()
        logger.info(f"Knowledge document removed: {name}")
        return True`,

  'app/services/call_manager.py': `"""
Call Manager Service - Handles call lifecycle
"""

import uuid
from datetime import datetime
from typing import Dict, Optional, List
from loguru import logger

from app.models.schemas import CallContext, CallStatus, CallLog


class CallManager:
    def __init__(self):
        self.active_calls: Dict[str, CallContext] = {}
        self.call_history: List[CallLog] = []
        self.max_concurrent_calls = 10
        
    async def start_call(self, caller_number: Optional[str] = None, caller_name: Optional[str] = None) -> CallContext:
        if len(self.active_calls) >= self.max_concurrent_calls:
            raise Exception("Maximum concurrent calls reached")
        
        call_id = str(uuid.uuid4())
        call = CallContext(
            call_id=call_id,
            caller_number=caller_number,
            caller_name=caller_name,
            status=CallStatus.ACTIVE,
            started_at=datetime.utcnow()
        )
        
        self.active_calls[call_id] = call
        logger.info(f"Call started: {call_id}")
        return call
    
    async def end_call(self, call_id: str) -> Optional[CallLog]:
        if call_id not in self.active_calls:
            return None
        
        call = self.active_calls.pop(call_id)
        duration = (datetime.utcnow() - call.started_at).total_seconds()
        
        log = CallLog(
            id=call_id[:8].upper(),
            caller=call.caller_name or "Unknown",
            number=call.caller_number or "Unknown",
            time=call.started_at.strftime("%Y-%m-%d %H:%M"),
            duration=f"{int(duration // 60)}:{int(duration % 60):02d}",
            status="resolved",
            intent="general_inquiry",
            satisfaction=4
        )
        
        self.call_history.insert(0, log)
        return log
    
    async def get_active_calls(self) -> List[CallContext]:
        return list(self.active_calls.values())
    
    async def get_call_history(self, limit: int = 50) -> List[CallLog]:
        return self.call_history[:limit]
    
    async def get_call_stats(self) -> dict:
        total = len(self.call_history)
        resolved = len([c for c in self.call_history if c.status == "resolved"])
        return {
            "total_calls": total + len(self.active_calls),
            "active_calls": len(self.active_calls),
            "resolved": resolved,
            "resolution_rate": (resolved / total * 100) if total > 0 else 0,
        }
    
    async def transfer_call(self, call_id: str, target: str) -> bool:
        if call_id not in self.active_calls:
            return False
        self.active_calls[call_id].status = CallStatus.TRANSFERRING
        return True
    
    async def hold_call(self, call_id: str) -> bool:
        if call_id not in self.active_calls:
            return False
        self.active_calls[call_id].status = CallStatus.ON_HOLD
        return True
`,

  'app/api/__init__.py': `# API module
`,

  'app/api/routes.py': `"""
API Routes - All endpoint definitions for the AI Receptionist Hub
"""

import uuid
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Request, UploadFile, File
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
        await websocket.close()`,
};
