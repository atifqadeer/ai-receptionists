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

  '.env.example': `# AI Receptionist - Environment Configuration
APP_NAME=AI Receptionist Hub
APP_ENV=development
APP_DEBUG=true
APP_HOST=0.0.0.0
APP_PORT=8000
APP_SECRET_KEY=your-super-secret-key-change-this

DATABASE_URL=sqlite:///./ai_receptionist.db
REDIS_URL=redis://localhost:6379/0

OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_TOKENS=500

ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-3-opus-20240229

ELEVENLABS_API_KEY=your-elevenlabs-api-key
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_MODEL_ID=eleven_multilingual_v2

DEEPGRAM_API_KEY=your-deepgram-api-key
DEEPGRAM_MODEL=nova-2

TWILIO_ACCOUNT_SID=ACyour-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_WEBHOOK_URL=http://localhost:8000/webhooks/twilio

GOOGLE_CALENDAR_CREDENTIALS_PATH=./credentials/google-calendar.json
GOOGLE_CALENDAR_ID=primary

SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_CHANNEL_ID=C0123456789

SENDGRID_API_KEY=SG.your-sendgrid-api-key
SENDGRID_FROM_EMAIL=receptionist@yourcompany.com

JWT_SECRET_KEY=your-jwt-secret-key
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
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
Core Configuration - Loads environment variables
"""

import os
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseSettings):
    APP_NAME: str = os.getenv("APP_NAME", "AI Receptionist Hub")
    APP_ENV: str = os.getenv("APP_ENV", "development")
    APP_DEBUG: bool = os.getenv("APP_DEBUG", "true").lower() == "true"
    APP_HOST: str = os.getenv("APP_HOST", "0.0.0.0")
    APP_PORT: int = int(os.getenv("APP_PORT", "8000"))
    APP_SECRET_KEY: str = os.getenv("APP_SECRET_KEY", "dev-secret-key")
    
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./ai_receptionist.db")
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4-turbo-preview")
    OPENAI_TEMPERATURE: float = float(os.getenv("OPENAI_TEMPERATURE", "0.7"))
    OPENAI_MAX_TOKENS: int = int(os.getenv("OPENAI_MAX_TOKENS", "500"))
    
    ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")
    ELEVENLABS_VOICE_ID: str = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    
    DEEPGRAM_API_KEY: str = os.getenv("DEEPGRAM_API_KEY", "")
    
    TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_PHONE_NUMBER: str = os.getenv("TWILIO_PHONE_NUMBER", "")
    TWILIO_WEBHOOK_URL: str = os.getenv("TWILIO_WEBHOOK_URL", "http://localhost:8000/webhooks/twilio")
    
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "jwt-secret-key")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
`,

  'app/core/database.py': `"""
Database Setup - SQLAlchemy async models
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=settings.APP_DEBUG)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
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


class AgentConfig(BaseModel):
    agent_name: str = "Aria"
    company_name: str = "TechCorp Solutions"
    language: str = "English"
    voice: str = "female-1"
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


class CallContext(BaseModel):
    call_id: str
    caller_number: Optional[str] = None
    caller_name: Optional[str] = None
    status: CallStatus = CallStatus.ACTIVE
    started_at: datetime = Field(default_factory=datetime.utcnow)
    duration_seconds: int = 0


class AgentResponse(BaseModel):
    message: str
    intent: str = "other"
    confidence: float = 0.0
    call_id: str
    timestamp: str
    requires_action: bool = False
    action_data: Dict[str, Any] = {}


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


class CallLog(BaseModel):
    id: str
    caller: str
    number: str
    time: str
    duration: str
    status: str
    intent: str
    satisfaction: int = 0
`,

  'app/services/__init__.py': `# Services module
`,

  'app/services/ai_agent.py': `"""
AI Agent Service - Core AI receptionist logic
"""

from typing import AsyncGenerator, Optional, Dict
from datetime import datetime
from loguru import logger
from openai import AsyncOpenAI

from app.core.config import settings
from app.models.schemas import AgentConfig, CallContext, AgentResponse


class AIAgent:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.config = self._load_default_config()
        self.conversation_history: Dict[str, list] = {}
        
    def _load_default_config(self) -> AgentConfig:
        return AgentConfig(
            agent_name="Aria",
            company_name="TechCorp Solutions",
            language="English",
            voice="female-1",
            greeting="Hello! Thank you for calling TechCorp Solutions. I'm Aria, your AI assistant. How can I help you today?",
            farewell="Thank you for calling! Have a wonderful day.",
            personality="professional",
            knowledge_base={
                "business_hours": "Monday to Friday, 9:00 AM to 6:00 PM EST",
                "address": "123 Innovation Drive, Suite 400, San Francisco, CA 94102",
                "phone": "+1 (555) 123-4567",
                "email": "support@techcorp.com",
                "services": "Web Development, Mobile Apps, Cloud Solutions, AI Integration"
            },
            faqs=[
                {"question": "What are your business hours?", "answer": "We are open Monday to Friday, 9 AM to 6 PM EST."},
                {"question": "How do I book an appointment?", "answer": "I can help you book an appointment right now."},
            ]
        )
    
    def _build_system_prompt(self) -> str:
        config = self.config
        kb = config.knowledge_base
        return f"""You are {config.agent_name}, a professional AI receptionist for {config.company_name}.

BUSINESS INFORMATION:
- Hours: {kb.get('business_hours', 'N/A')}
- Address: {kb.get('address', 'N/A')}
- Phone: {kb.get('phone', 'N/A')}
- Email: {kb.get('email', 'N/A')}
- Services: {kb.get('services', 'N/A')}

RULES:
1. Greet callers warmly
2. Identify caller's intent
3. Provide accurate information
4. Offer transfer to human if needed
5. Keep responses concise (voice-friendly)
6. Never make up information
7. Confirm important details
8. End calls politely
"""

    async def process_message(self, call_id: str, user_message: str, context: Optional[CallContext] = None) -> AgentResponse:
        if call_id not in self.conversation_history:
            self.conversation_history[call_id] = [
                {"role": "system", "content": self._build_system_prompt()}
            ]
            logger.info(f"New call: {call_id}")
        
        self.conversation_history[call_id].append({"role": "user", "content": user_message})
        
        try:
            response = await self.client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=self.conversation_history[call_id],
                temperature=settings.OPENAI_TEMPERATURE,
                max_tokens=settings.OPENAI_MAX_TOKENS,
            )
            
            agent_message = response.choices[0].message.content
            self.conversation_history[call_id].append({"role": "assistant", "content": agent_message})
            
            intent = await self._detect_intent(call_id, user_message)
            
            return AgentResponse(
                message=agent_message,
                intent=intent,
                confidence=0.95,
                call_id=call_id,
                timestamp=datetime.utcnow().isoformat(),
                requires_action=intent in ["appointment_booking", "transfer_request", "complaint"],
                action_data={"action": "collect_details" if intent == "appointment_booking" else "none"}
            )
            
        except Exception as e:
            logger.error(f"Error: {e}")
            return AgentResponse(
                message="I'm sorry, I'm having trouble right now. Let me connect you with someone.",
                intent="error",
                confidence=0.0,
                call_id=call_id,
                timestamp=datetime.utcnow().isoformat(),
                requires_action=True,
                action_data={"action": "transfer_to_human"}
            )
    
    async def _detect_intent(self, call_id: str, message: str) -> str:
        intent_prompt = f"""Analyze this message and return ONLY the intent category.
Message: "{message}"
Categories: appointment_booking, business_hours, general_inquiry, technical_support, complaint, transfer_request, pricing, other
Return only the category name."""

        try:
            response = await self.client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": intent_prompt}],
                temperature=0.1,
                max_tokens=20
            )
            intent = response.choices[0].message.content.strip().lower()
            valid = ["appointment_booking", "business_hours", "general_inquiry", "technical_support", "complaint", "transfer_request", "pricing", "other"]
            return intent if intent in valid else "other"
        except:
            return "other"
    
    def end_call(self, call_id: str) -> dict:
        history = self.conversation_history.pop(call_id, [])
        return {"call_id": call_id, "messages_count": len(history), "ended_at": datetime.utcnow().isoformat()}
    
    def update_config(self, config_data: dict) -> AgentConfig:
        for key, value in config_data.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)
        return self.config
    
    def get_config(self) -> AgentConfig:
        return self.config
`,

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
API Routes - All endpoint definitions
"""

import uuid
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Request
from loguru import logger

from app.models.schemas import AgentConfig, AgentResponse, CallContext, CallLog, AutomationRule, Workflow

agent_router = APIRouter()

@agent_router.get("/config")
async def get_agent_config(request: Request):
    return request.app.state.ai_agent.get_config()

@agent_router.put("/config")
async def update_agent_config(request: Request, config: dict):
    return {"status": "success", "config": request.app.state.ai_agent.update_config(config)}

@agent_router.post("/chat")
async def chat_with_agent(request: Request, data: dict):
    agent = request.app.state.ai_agent
    call_id = data.get("call_id", str(uuid.uuid4()))
    message = data.get("message", "")
    if not message:
        raise HTTPException(status_code=400, detail="Message required")
    return await agent.process_message(call_id, message)

@agent_router.post("/call/start")
async def start_call(request: Request, data: Optional[dict] = None):
    call_manager = request.app.state.call_manager
    data = data or {}
    call = await call_manager.start_call(data.get("caller_number"), data.get("caller_name"))
    greeting = request.app.state.ai_agent.get_config().greeting
    return {"call_id": call.call_id, "status": call.status, "greeting": greeting}

@agent_router.post("/call/{call_id}/end")
async def end_call(request: Request, call_id: str):
    log = await request.app.state.call_manager.end_call(call_id)
    request.app.state.ai_agent.end_call(call_id)
    farewell = request.app.state.ai_agent.get_config().farewell
    return {"status": "ended", "call_log": log, "farewell": farewell}

automation_router = APIRouter()

_automation_rules = [
    AutomationRule(id=1, name="After Hours Routing", trigger="Call outside business hours", action="Play message + callback", enabled=True, priority=1),
    AutomationRule(id=2, name="Appointment Booking", trigger="Intent: Appointment", action="Collect details → Confirm → SMS", enabled=True, priority=2),
    AutomationRule(id=3, name="Emergency Escalation", trigger="Keywords: emergency, urgent", action="Transfer to on-call staff", enabled=True, priority=0),
]

@automation_router.get("/rules")
async def get_rules():
    return sorted(_automation_rules, key=lambda r: r.priority)

@automation_router.post("/rules")
async def create_rule(rule: dict):
    new_rule = AutomationRule(id=len(_automation_rules) + 1, name=rule.get("name", ""), trigger=rule.get("trigger", ""), action=rule.get("action", ""), enabled=True, priority=len(_automation_rules) + 1)
    _automation_rules.append(new_rule)
    return new_rule

@automation_router.put("/rules/{rule_id}/toggle")
async def toggle_rule(rule_id: int):
    for rule in _automation_rules:
        if rule.id == rule_id:
            rule.enabled = not rule.enabled
            return {"status": "success", "rule": rule}
    raise HTTPException(status_code=404, detail="Rule not found")

@automation_router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int):
    global _automation_rules
    _automation_rules = [r for r in _automation_rules if r.id != rule_id]
    return {"status": "deleted"}

calls_router = APIRouter()

@calls_router.get("/active")
async def get_active_calls(request: Request):
    return await request.app.state.call_manager.get_active_calls()

@calls_router.get("/history")
async def get_history(request: Request, limit: int = 50):
    return await request.app.state.call_manager.get_call_history(limit)

@calls_router.get("/stats")
async def get_stats(request: Request):
    return await request.app.state.call_manager.get_call_stats()

analytics_router = APIRouter()

@analytics_router.get("/dashboard")
async def get_dashboard(request: Request):
    stats = await request.app.state.call_manager.get_call_stats()
    return {"total_calls": stats.get("total_calls", 1247), "calls_handled": stats.get("resolved", 1189), "avg_response_time": 1.2, "satisfaction_rate": 94.7}

@analytics_router.get("/hourly")
async def get_hourly():
    return [{"hour": "9AM", "calls": 45}, {"hour": "10AM", "calls": 67}, {"hour": "11AM", "calls": 54}]

settings_router = APIRouter()

@settings_router.get("/general")
async def get_general():
    return {"system_name": "AI Receptionist Hub", "timezone": "America/New_York", "enable_notifications": True}

@settings_router.put("/general")
async def update_general(data: dict):
    return {"status": "success", "settings": data}

@settings_router.get("/team")
async def get_team():
    return [{"id": 1, "name": "Alex Thompson", "role": "Admin", "email": "alex@techcorp.com", "status": "active"}]

webhooks_router = APIRouter()

@webhooks_router.post("/twilio")
async def twilio_webhook(request: Request):
    form = await request.form()
    twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Hello! I'm Aria, your AI assistant. How can I help?</Say>
    <Gather input="speech" action="/webhooks/twilio/gather" method="POST" timeout="5"/>
</Response>"""
    from fastapi.responses import Response
    return Response(content=twiml, media_type="application/xml")

websocket_router = APIRouter()

@websocket_router.websocket("/call/{call_id}")
async def websocket_call(websocket: WebSocket, call_id: str):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "text":
                agent = websocket.app.state.ai_agent
                response = await agent.process_message(call_id, data.get("data", {}).get("message", ""))
                await websocket.send_json({"type": "response", "data": {"message": response.message, "intent": response.intent}, "call_id": call_id})
            elif data.get("type") == "end_call":
                await websocket.app.state.call_manager.end_call(call_id)
                await websocket.send_json({"type": "status", "data": {"message": "Call ended"}, "call_id": call_id})
                break
    except WebSocketDisconnect:
        pass
`,
};
