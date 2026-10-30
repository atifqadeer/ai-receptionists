# 🚀 QUICK START GUIDE - Run AI Receptionist on Your Local PC

## Step-by-Step Instructions

---

### ✅ STEP 1: Install Prerequisites

**You need these installed on your PC:**

1. **Python 3.9+** 
   - Download from: https://www.python.org/downloads/
   - During installation, CHECK "Add Python to PATH"
   - Verify: Open terminal/command prompt and type `python --version`

2. **Node.js 18+** (for the frontend UI)
   - Download from: https://nodejs.org/
   - Verify: Type `node --version`

---

### ✅ STEP 2: Get Your OpenAI API Key (REQUIRED)

1. Go to https://platform.openai.com/api-keys
2. Sign up / Log in
3. Click "Create new secret key"
4. Copy the key (starts with `sk-...`)
5. **Keep it safe!** You'll need it in Step 4

---

### ✅ STEP 3: Set Up the Python Backend

Open your terminal/command prompt and run:

```bash
# Navigate to the Python backend folder
cd python-backend

# Create a virtual environment
python -m venv venv

# Activate the virtual environment:
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install all dependencies
pip install -r requirements.txt
```

---

### ✅ STEP 4: Configure Your API Keys

```bash
# Copy the example env file
cp .env.example .env

# Open .env in a text editor and add your keys:
# OPENAI_API_KEY=sk-your-actual-key-here
```

**Minimum required key:**
```
OPENAI_API_KEY=sk-your-key-here
```

**Optional keys for full features:**
```
# For real phone calls:
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+1234567890

# For voice synthesis:
ELEVENLABS_API_KEY=your-key

# For speech recognition:
DEEPGRAM_API_KEY=your-key
```

---

### ✅ STEP 5: Start the Backend Server

```bash
# Make sure you're in the python-backend folder
# and your virtual environment is activated

# Option A: Use the quick start script
python start.py

# Option B: Start manually
python main.py
```

You should see:
```
🚀 Starting AI Receptionist Hub...
INFO:     Uvicorn running on http://0.0.0.0:8000
```

✅ Backend is running at: **http://localhost:8000**
✅ API Documentation at: **http://localhost:8000/docs**

---

### ✅ STEP 6: Start the Frontend UI

Open a **SECOND terminal** (keep the backend running in the first one):

```bash
# Go to the project root (one level up from python-backend)
cd ..

# Install frontend dependencies
npm install

# Start the development server
npm run dev
```

You should see:
```
VITE v5.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

✅ Frontend UI at: **http://localhost:5173**

---

### ✅ STEP 7: Open Your Browser

1. **Main Dashboard**: http://localhost:5173
2. **API Docs**: http://localhost:8000/docs

---

## 🎮 How to Use

### 1. Dashboard
- View real-time call statistics
- See recent calls and their outcomes
- Monitor call intents and trends

### 2. Agent Setup
- Configure the AI agent's name and personality
- Set up greeting/farewell messages
- Add your business information
- Manage FAQs
- Choose voice settings

### 3. Automation
- Create call routing rules
- Set up automated workflows
- Manage connected services

### 4. Live Simulator
- Test the AI agent with simulated conversations
- See real-time intent detection
- Practice different call scenarios

### 5. Analytics
- View detailed call history
- Analyze performance metrics
- Export reports

### 6. Settings
- Configure telephony (Twilio)
- Set up AI model parameters
- Manage team members
- Handle API keys

---

## 🔧 Troubleshooting

### "Python not found"
- Install Python from python.org
- Make sure to check "Add to PATH" during installation
- Restart your terminal after installing

### "pip: command not found"
- Run: `python -m ensurepip --upgrade`
- Or: `python -m pip install --upgrade pip`

### "Module not found" errors
- Make sure your virtual environment is activated
- Run: `pip install -r requirements.txt`

### "Port 8000 already in use"
- Kill the existing process: 
  - Windows: `netstat -ano | findstr :8000` then `taskkill /PID <number> /F`
  - macOS/Linux: `lsof -ti:8000 | xargs kill`
- Or change the port in `.env`: `APP_PORT=8001`

### "OPENAI_API_KEY not set"
- Edit the `.env` file in `python-backend/`
- Add: `OPENAI_API_KEY=sk-your-actual-key`
- Restart the server

### Frontend not connecting to backend
- Make sure both servers are running
- Backend should be on port 8000
- Check browser console for CORS errors

---

## 📁 Project Structure

```
ai-receptionist-hub/
├── python-backend/          ← Python backend (FastAPI)
│   ├── main.py             ← Entry point
│   ├── start.py            ← Quick start script
│   ├── requirements.txt    ← Python dependencies
│   ├── .env.example        ← Environment template
│   ├── setup.sh/bat        ← Setup scripts
│   ├── README.md           ← Backend documentation
│   └── app/
│       ├── core/           ← Config & database
│       ├── models/         ← Data schemas
│       ├── services/       ← AI agent & call manager
│       └── api/            ← API routes
│
├── src/                     ← React frontend
│   ├── App.tsx             ← Main app component
│   └── components/         ← UI pages
│       ├── Dashboard.tsx
│       ├── SetupForm.tsx
│       ├── Automation.tsx
│       ├── CallSimulator.tsx
│       ├── Analytics.tsx
│       └── Settings.tsx
│
├── index.html               ← HTML entry point
├── package.json             ← Node.js dependencies
└── QUICKSTART.md           ← This file!
```

---

## 💡 Tips

1. **Start with the Simulator** - Test your AI agent before connecting real phones
2. **Configure Knowledge Base** - Add your actual business info for accurate responses
3. **Set Up Automation Rules** - Automate common call scenarios
4. **Monitor Analytics** - Track performance and improve over time
5. **Use Multiple AI Providers** - Switch between OpenAI, Anthropic, or Google

---

## 🆘 Need Help?

- **API Documentation**: http://localhost:8000/docs (when backend is running)
- **Check Logs**: Look at terminal output for error messages
- **Verify .env**: Make sure all required API keys are set
- **Check Ports**: Ensure 8000 (backend) and 5173 (frontend) are available

---

## 🎉 You're All Set!

Your AI Receptionist is now running locally. Start by:
1. Configuring the agent in "Agent Setup"
2. Testing conversations in "Live Simulator"
3. Setting up automation rules
4. (Optional) Connecting Twilio for real phone calls

Happy automating! 🤖📞
