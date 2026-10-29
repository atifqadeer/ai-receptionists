# 🤖 AI Receptionist & Automation Hub

A complete AI-powered receptionist system with a modern web dashboard and Python backend. Features real-time call handling, AI conversation, automation workflows, and comprehensive analytics.

![Python](https://img.shields.io/badge/Python-3.9+-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109-green)
![React](https://img.shields.io/badge/React-18-blue)
![Tailwind](https://img.shields.io/badge/Tailwind-3.0-cyan)

---

## 📋 Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick Start](#quick-start)
5. [Backend Setup (Python)](#backend-setup)
6. [Frontend Setup (React)](#frontend-setup)
7. [Configuration](#configuration)
8. [API Documentation](#api-documentation)
9. [Python Code Structure](#python-code-structure)
10. [Running the Full System](#running-the-full-system)

---

## ✨ Features

### 🎙️ AI Receptionist Agent
- Natural language conversation with callers
- Intent detection (appointments, inquiries, support, complaints)
- Configurable personality (professional, friendly, casual, empathetic)
- Multi-language support
- Voice synthesis with ElevenLabs
- Speech recognition with Deepgram

### 📞 Call Management
- Real-time call handling via WebSocket
- Twilio integration for phone calls
- Call routing and transfer
- Hold/resume functionality
- Call recording and transcription
- Voicemail fallback

### ⚡ Automation Engine
- Custom routing rules with priority system
- Multi-step automated workflows
- After-hours handling
- Emergency escalation
- VIP caller detection
- Survey collection

### 📊 Analytics Dashboard
- Real-time call statistics
- Hourly/daily/weekly distribution
- Intent analysis
- Customer satisfaction tracking
- Resolution rates and trends
- Exportable reports

### 🔧 Configuration
- Agent identity and voice settings
- Knowledge base management
- FAQ system
- Team management
- API key management
- Multiple AI provider support (OpenAI, Anthropic, Google)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)                    │
│  ┌──────────┬──────────┬──────────┬──────────┬────────────┐ │
│  │Dashboard │  Setup   │Automation│Simulator │ Analytics  │ │
│  └──────────┴──────────┴──────────┴──────────┴────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API + WebSocket
┌──────────────────────────┴──────────────────────────────────┐
│                  Backend (Python FastAPI)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  API Routes │ WebSocket │ Webhooks (Twilio)          │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐   │
│  │  AI Agent    │ │Call Manager  │ │  Automation      │   │
│  │  (OpenAI)    │ │              │ │  Engine          │   │
│  └──────────────┘ └──────────────┘ └──────────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐   │
│  │  Database    │ │  Redis Cache │ │  Task Queue      │   │
│  │  (SQLite)    │ │              │ │  (Celery)        │   │
│  └──────────────┘ └──────────────┘ └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│                    External Services                          │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │
│  │ OpenAI  │ │ ElevenLabs│ │ Deepgram │ │ Twilio (Calls) │ │
│  │  (LLM)  │ │  (TTS)   │ │  (STT)   │ │                │ │
│  └─────────┘ └──────────┘ └──────────┘ └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Prerequisites

### Required:
- **Python 3.9+** - [Download](https://www.python.org/downloads/)
- **Node.js 18+** - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/)

### API Keys (at least one required):
- **OpenAI API Key** - [Get Key](https://platform.openai.com/api-keys) (Required for AI agent)

### Optional (for full functionality):
- **Twilio** - [Sign Up](https://www.twilio.com/try-twilio) (For phone calls)
- **ElevenLabs** - [Sign Up](https://elevenlabs.io/) (For voice synthesis)
- **Deepgram** - [Sign Up](https://deepgram.com/) (For speech recognition)

---

## 🚀 Quick Start

### 1. Clone/Download the project

```bash
# If using git
git clone <your-repo-url>
cd ai-receptionist-hub
```

### 2. Set up the Python Backend

```bash
cd python-backend

# On macOS/Linux:
chmod +x setup.sh
./setup.sh

# On Windows:
setup.bat
```

### 3. Configure API Keys

```bash
# Edit the .env file
nano .env  # or use any text editor

# Add at minimum:
OPENAI_API_KEY=sk-your-actual-key-here
```

### 4. Start the Backend

```bash
cd python-backend
source venv/bin/activate  # Windows: venv\Scripts\activate
python main.py
```

### 5. Start the Frontend (in another terminal)

```bash
npm install
npm run dev
```

### 6. Open the Application

- **Frontend UI**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

---

## 🔧 Backend Setup (Python)

### Manual Setup

```bash
# Navigate to backend directory
cd python-backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
# Start the server
python main.py
```

### Dependencies Explained

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework for the API |
| `uvicorn` | ASGI server |
| `openai` | AI conversation engine |
| `twilio` | Phone call handling |
| `elevenlabs` | Text-to-speech |
| `deepgram-sdk` | Speech-to-text |
| `sqlalchemy` | Database ORM |
| `redis` | Caching and queuing |
| `celery` | Background task processing |
| `pydantic` | Data validation |
| `loguru` | Logging |

---

## 🎨 Frontend Setup (React)

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

## ⚙️ Configuration

### Environment Variables (.env)

```bash
# Required
OPENAI_API_KEY=sk-your-key-here

# For Phone Calls
TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+1234567890

# For Voice (TTS)
ELEVENLABS_API_KEY=your-key
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM

# For Speech Recognition (STT)
DEEPGRAM_API_KEY=your-key
```

### Agent Configuration

Configure via the UI (Agent Setup page) or API:

```bash
curl -X PUT http://localhost:8000/api/agent/config \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "Aria",
    "company_name": "Your Company",
    "personality": "professional",
    "greeting": "Hello! How can I help you today?"
  }'
```

---

## 📚 API Documentation

Once the backend is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agent/config` | Get agent configuration |
| PUT | `/api/agent/config` | Update agent configuration |
| POST | `/api/agent/chat` | Send message to AI agent |
| POST | `/api/agent/call/start` | Start a new call |
| POST | `/api/agent/call/{id}/end` | End a call |
| GET | `/api/automation/rules` | Get automation rules |
| POST | `/api/automation/rules` | Create automation rule |
| GET | `/api/calls/history` | Get call history |
| GET | `/api/analytics/dashboard` | Get dashboard stats |
| WS | `/ws/call/{call_id}` | WebSocket for real-time calls |
| POST | `/webhooks/twilio` | Twilio webhook handler |

---

## 📁 Python Code Structure

```
python-backend/
├── main.py                    # FastAPI application entry point
├── requirements.txt           # Python dependencies
├── .env.example              # Environment variables template
├── setup.sh / setup.bat      # Setup scripts
│
├── app/
│   ├── __init__.py
│   │
│   ├── core/                 # Core configuration
│   │   ├── __init__.py
│   │   ├── config.py         # Settings & environment loading
│   │   └── database.py       # Database setup & models
│   │
│   ├── models/               # Data models
│   │   ├── __init__.py
│   │   └── schemas.py        # Pydantic schemas
│   │
│   ├── services/             # Business logic
│   │   ├── __init__.py
│   │   ├── ai_agent.py       # AI conversation engine
│   │   └── call_manager.py   # Call lifecycle management
│   │
│   └── api/                  # API endpoints
│       ├── __init__.py
│       └── routes.py         # All route definitions
│
├── data/                     # Database files
├── logs/                     # Application logs
└── credentials/              # Service account credentials
```

### Key Files Explained

#### `main.py`
- FastAPI application setup
- Lifespan events (startup/shutdown)
- CORS configuration
- Route registration

#### `app/services/ai_agent.py`
- Core AI conversation logic
- OpenAI integration
- Intent detection
- System prompt management
- Conversation memory

#### `app/services/call_manager.py`
- Call lifecycle (start, hold, transfer, end)
- Active call tracking
- Call history and statistics

#### `app/api/routes.py`
- All REST API endpoints
- WebSocket handler for real-time calls
- Twilio webhook handlers
- Analytics endpoints

---

## 🖥️ Running the Full System

### Option 1: Development Mode (Two Terminals)

**Terminal 1 - Backend:**
```bash
cd python-backend
source venv/bin/activate
python main.py
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

### Option 2: Production Mode

```bash
# Build frontend
npm run build

# Serve frontend with backend
cd python-backend
# Copy dist/ to python-backend/static/
# Update main.py to serve static files
python main.py
```

### Option 3: Docker (Coming Soon)

```bash
docker-compose up -d
```

---

## 🔌 Integrations

### Twilio (Phone Calls)
1. Sign up at [twilio.com](https://www.twilio.com)
2. Get a phone number
3. Set webhook URL to: `https://your-domain.com/webhooks/twilio`
4. Add credentials to `.env`

### ElevenLabs (Voice)
1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Choose a voice ID
3. Add API key to `.env`

### Deepgram (Speech Recognition)
1. Sign up at [deepgram.com](https://deepgram.com)
2. Add API key to `.env`

### Google Calendar
1. Create a Google Cloud project
2. Enable Calendar API
3. Download credentials JSON
4. Place in `credentials/google-calendar.json`

---

## 🧪 Testing

```bash
# Test the API
curl http://localhost:8000/health

# Test AI chat
curl -X POST http://localhost:8000/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "I need to book an appointment", "call_id": "test-123"}'

# Run Python tests
cd python-backend
pytest
```

---

## 📝 License

MIT License - Feel free to use this project for your own purposes.

---

## 🤝 Support

For issues and questions:
- Check the API docs at http://localhost:8000/docs
- Review the logs in `python-backend/logs/`
- Ensure all API keys are correctly set in `.env`
