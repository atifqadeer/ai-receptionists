# 📥 How to Download the Python Backend

Your AI Receptionist system is ready! Here are **3 ways** to download the complete Python backend:

---

## 🎯 Method 1: Download Button (Recommended)

### Option A: From Dashboard
1. Open the web application
2. Look for the **"Download Python Backend"** card at the top of the Dashboard
3. Click the **"Download ZIP"** button
4. The file `ai-receptionist-python-backend.zip` will download automatically

### Option B: From Sidebar
1. Look at the left sidebar
2. Click the purple **"Download Backend"** button
3. The ZIP file will download

### Option C: Direct Download Page
1. Navigate to: `http://localhost:5173/download.html`
2. Click the large **"Download Python Backend (ZIP)"** button
3. The file will download automatically

---

## 📦 What's in the ZIP?

```
ai-receptionist-python-backend/
├── main.py                    # FastAPI application entry point
├── requirements.txt           # Python dependencies
├── .env.example              # Environment configuration template
├── .gitignore                # Git ignore rules
├── README.md                 # Documentation
├── QUICKSTART.md             # Quick start guide
├── app/
│   ├── __init__.py
│   ├── core/
│   │   ├── config.py         # Configuration & settings
│   │   └── database.py       # Database setup
│   ├── models/
│   │   └── schemas.py        # Pydantic data models
│   ├── services/
│   │   ├── ai_agent.py       # AI conversation engine
│   │   └── call_manager.py   # Call lifecycle management
│   └── api/
│       └── routes.py         # All API endpoints
```

---

## 🚀 Quick Start After Download

### Step 1: Extract the ZIP
```bash
unzip ai-receptionist-python-backend.zip
cd ai-receptionist-python-backend
```

### Step 2: Install Python (if not installed)
- Download from: https://www.python.org/downloads/
- Version 3.9 or higher required
- **Important**: Check "Add Python to PATH" during installation

### Step 3: Create Virtual Environment
```bash
# Create virtual environment
python -m venv venv

# Activate it:
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate
```

### Step 4: Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 5: Get Your OpenAI API Key
1. Go to: https://platform.openai.com/api-keys
2. Sign up / Log in
3. Click "Create new secret key"
4. Copy the key (starts with `sk-...`)

### Step 6: Configure Environment
```bash
# Copy the template
cp .env.example .env

# Edit .env file and add your key:
# OPENAI_API_KEY=sk-your-actual-key-here
```

### Step 7: Start the Server
```bash
python main.py
```

You should see:
```
🚀 Starting AI Receptionist Hub...
✅ Database initialized
✅ AI Agent initialized
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Step 8: Open Your Browser
- **API Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health
- **Root**: http://localhost:8000

---

## 🧪 Test Your Setup

Run the test script to verify everything works:
```bash
python test_setup.py
```

This will check:
- ✅ Python version
- ✅ Dependencies installed
- ✅ Environment configured
- ✅ App modules importable

---

## 📚 API Endpoints

Once running, you can test these endpoints:

### Health Check
```bash
curl http://localhost:8000/health
```

### Chat with AI Agent
```bash
curl -X POST http://localhost:8000/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "I need to book an appointment", "call_id": "test-123"}'
```

### Start a Call
```bash
curl -X POST http://localhost:8000/api/agent/call/start \
  -H "Content-Type: application/json" \
  -d '{"caller_name": "John Doe", "caller_number": "+1234567890"}'
```

### Get Automation Rules
```bash
curl http://localhost:8000/api/automation/rules
```

### Get Analytics
```bash
curl http://localhost:8000/api/analytics/dashboard
```

---

## 🔧 Optional: Full Features

### For Phone Calls (Twilio)
1. Sign up at: https://www.twilio.com/try-twilio
2. Get a phone number
3. Add to `.env`:
   ```
   TWILIO_ACCOUNT_SID=your-sid
   TWILIO_AUTH_TOKEN=your-token
   TWILIO_PHONE_NUMBER=+1234567890
   ```

### For Voice Synthesis (ElevenLabs)
1. Sign up at: https://elevenlabs.io/
2. Add to `.env`:
   ```
   ELEVENLABS_API_KEY=your-key
   ```

### For Speech Recognition (Deepgram)
1. Sign up at: https://deepgram.com/
2. Add to `.env`:
   ```
   DEEPGRAM_API_KEY=your-key
   ```

---

## 🆘 Troubleshooting

### "Python not found"
- Install Python from python.org
- Check "Add to PATH" during installation
- Restart terminal after installing

### "pip: command not found"
```bash
python -m ensurepip --upgrade
python -m pip install --upgrade pip
```

### "Module not found" errors
```bash
# Make sure venv is activated
# Then reinstall
pip install -r requirements.txt
```

### "Port 8000 already in use"
Edit `.env` and change:
```
APP_PORT=8001
```

### "OPENAI_API_KEY not set"
Edit `.env` and add:
```
OPENAI_API_KEY=sk-your-actual-key-here
```

### Virtual environment won't activate
- **Windows**: Use `venv\Scripts\activate` (not `source`)
- **macOS/Linux**: Use `source venv/bin/activate`
- Make sure you're in the correct directory

---

## 📖 Documentation

- **API Docs**: http://localhost:8000/docs (Swagger UI)
- **Alternative Docs**: http://localhost:8000/redoc (ReDoc)
- **README**: See `README.md` in the ZIP
- **Quick Start**: See `QUICKSTART.md` in the ZIP

---

## 💡 Tips

1. **Start Simple**: Begin with just the OpenAI API key, add other services later
2. **Test First**: Use the Live Simulator in the frontend UI to test conversations
3. **Monitor Logs**: Check terminal output for debugging
4. **Secure Keys**: Never commit `.env` to git (it's in .gitignore)
5. **Production**: For production, use PostgreSQL instead of SQLite

---

## 🎉 You're All Set!

Your AI Receptionist backend is now running locally. You can:
- ✅ Chat with the AI agent via API
- ✅ Manage calls and automation
- ✅ View analytics
- ✅ Connect to the frontend UI
- ✅ (Optional) Connect real phone calls via Twilio

**Next Steps:**
1. Configure the agent in the frontend UI (Agent Setup page)
2. Test conversations in the Live Simulator
3. Set up automation rules
4. Explore the analytics dashboard

Happy automating! 🤖📞
