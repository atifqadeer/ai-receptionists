#!/bin/bash
# ============================================
# AI Receptionist Hub - Local Setup Script
# ============================================
# Run this script to set up the project on your local machine

echo "🤖 AI Receptionist Hub - Local Setup"
echo "======================================"
echo ""

# Check Python version
echo "📋 Checking Python version..."
python_version=$(python3 --version 2>&1)
if [ $? -eq 0 ]; then
    echo "✅ $python_version"
else
    echo "❌ Python 3 not found. Please install Python 3.9+ from https://python.org"
    exit 1
fi

# Check if pip is available
echo "📋 Checking pip..."
pip_version=$(pip3 --version 2>&1)
if [ $? -eq 0 ]; then
    echo "✅ $pip_version"
else
    echo "❌ pip not found. Please install pip."
    exit 1
fi

# Create virtual environment
echo ""
echo "🔧 Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate
echo "✅ Virtual environment created and activated"

# Install dependencies
echo ""
echo "📦 Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
echo "✅ Dependencies installed"

# Create .env file from example
echo ""
echo "📝 Setting up environment configuration..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ .env file created from .env.example"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file and add your API keys:"
    echo "   - OPENAI_API_KEY (required for AI agent)"
    echo "   - TWILIO_ACCOUNT_SID & TWILIO_AUTH_TOKEN (for phone calls)"
    echo "   - ELEVENLABS_API_KEY (for voice synthesis)"
    echo "   - DEEPGRAM_API_KEY (for speech recognition)"
else
    echo "✅ .env file already exists"
fi

# Create necessary directories
echo ""
echo "📁 Creating directories..."
mkdir -p data
mkdir -p logs
mkdir -p credentials
echo "✅ Directories created"

# Initialize database
echo ""
echo "🗄️  Initializing database..."
python3 -c "
import asyncio
from app.core.database import init_db
asyncio.run(init_db())
print('✅ Database initialized')
" 2>/dev/null || echo "⚠️  Database will be initialized on first run"

echo ""
echo "======================================"
echo "🎉 Setup Complete!"
echo "======================================"
echo ""
echo "To start the server:"
echo "  source venv/bin/activate"
echo "  python main.py"
echo ""
echo "The API will be available at: http://localhost:8000"
echo "API Documentation: http://localhost:8000/docs"
echo ""
echo "To start with the frontend UI:"
echo "  cd .. && npm run dev"
echo ""
