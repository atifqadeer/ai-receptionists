#!/usr/bin/env python3
"""
Quick Start Script - Run this to start the AI Receptionist Hub
Usage: python start.py
"""

import os
import sys
import subprocess
import time
import webbrowser

def check_python():
    """Check Python version"""
    if sys.version_info < (3, 9):
        print("❌ Python 3.9+ required. Please upgrade Python.")
        sys.exit(1)
    print(f"✅ Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")

def check_env():
    """Check if .env file exists"""
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if not os.path.exists(env_path):
        example_path = os.path.join(os.path.dirname(__file__), '.env.example')
        if os.path.exists(example_path):
            import shutil
            shutil.copy(example_path, env_path)
            print("✅ Created .env from .env.example")
            print("\n⚠️  IMPORTANT: Edit .env and add your OPENAI_API_KEY!")
            print("   File location: python-backend/.env")
            input("\nPress Enter after adding your API key...")
        else:
            print("⚠️  No .env file found. Creating default...")
            with open(env_path, 'w') as f:
                f.write("OPENAI_API_KEY=your-key-here\n")
    else:
        print("✅ .env file found")

def install_deps():
    """Install Python dependencies"""
    print("\n📦 Installing dependencies...")
    try:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "-q"
        ])
        print("✅ Dependencies installed")
    except subprocess.CalledProcessError:
        print("❌ Failed to install dependencies. Try: pip install -r requirements.txt")
        sys.exit(1)

def init_db():
    """Initialize the database"""
    print("\n🗄️  Initializing database...")
    try:
        from app.core.database import init_db
        import asyncio
        asyncio.run(init_db())
        print("✅ Database ready")
    except Exception as e:
        print(f"⚠️  Database init skipped: {e}")

def start_server():
    """Start the FastAPI server"""
    print("\n🚀 Starting AI Receptionist Hub...")
    print("=" * 50)
    print("  📡 API:       http://localhost:8000")
    print("  📖 API Docs:  http://localhost:8000/docs")
    print("  💚 Health:    http://localhost:8000/health")
    print("=" * 50)
    print("\nPress Ctrl+C to stop the server\n")
    
    # Open API docs in browser
    time.sleep(2)
    webbrowser.open("http://localhost:8000/docs")
    
    # Start server
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

def main():
    print("\n🤖 AI Receptionist Hub - Quick Start")
    print("=" * 40)
    
    # Change to script directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    check_python()
    check_env()
    install_deps()
    init_db()
    start_server()

if __name__ == "__main__":
    main()
