"""
Test Script - Verify your AI Receptionist setup is working
Run: python test_setup.py
"""

import os
import sys

def test_python_version():
    """Test Python version"""
    print("1. Testing Python version...", end=" ")
    if sys.version_info >= (3, 9):
        print(f"✅ Python {sys.version_info.major}.{sys.version_info.minor}")
        return True
    else:
        print(f"❌ Need Python 3.9+, got {sys.version_info.major}.{sys.version_info.minor}")
        return False

def test_dependencies():
    """Test required packages are installed"""
    print("2. Testing dependencies...", end=" ")
    missing = []
    
    packages = {
        'fastapi': 'fastapi',
        'uvicorn': 'uvicorn',
        'openai': 'openai',
        'pydantic': 'pydantic',
        'sqlalchemy': 'sqlalchemy',
        'httpx': 'httpx',
        'loguru': 'loguru',
    }
    
    for import_name, pip_name in packages.items():
        try:
            __import__(import_name)
        except ImportError:
            missing.append(pip_name)
    
    if not missing:
        print("✅ All core dependencies installed")
        return True
    else:
        print(f"❌ Missing: {', '.join(missing)}")
        print(f"   Run: pip install {' '.join(missing)}")
        return False

def test_env_file():
    """Test .env file exists and has required keys"""
    print("3. Testing environment configuration...", end=" ")
    
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if not os.path.exists(env_path):
        print("❌ .env file not found")
        print("   Run: cp .env.example .env")
        return False
    
    # Check for required keys
    from dotenv import load_dotenv
    load_dotenv(env_path)
    
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if not openai_key or openai_key == "sk-your-openai-api-key-here":
        print("⚠️  OPENAI_API_KEY not set (AI features won't work)")
        print("   Edit .env and add your OpenAI API key")
        return False
    
    print("✅ Environment configured")
    return True

def test_imports():
    """Test that app modules can be imported"""
    print("4. Testing app imports...", end=" ")
    try:
        from app.core.config import settings
        from app.models.schemas import AgentConfig, AgentResponse
        from app.services.ai_agent import AIAgent
        from app.services.call_manager import CallManager
        print("✅ All modules importable")
        return True
    except Exception as e:
        print(f"❌ Import error: {e}")
        return False

def test_ai_agent():
    """Test AI agent initialization"""
    print("5. Testing AI Agent...", end=" ")
    try:
        from app.services.ai_agent import AIAgent
        agent = AIAgent()
        config = agent.get_config()
        print(f"✅ Agent '{config.agent_name}' ready")
        return True
    except Exception as e:
        print(f"⚠️  Agent init issue: {e}")
        return False

def test_database():
    """Test database connection"""
    print("6. Testing database...", end=" ")
    try:
        import asyncio
        from app.core.database import init_db
        asyncio.run(init_db())
        print("✅ Database initialized")
        return True
    except Exception as e:
        print(f"⚠️  Database issue: {e}")
        return False

def main():
    print("\n🧪 AI Receptionist Hub - Setup Verification")
    print("=" * 50)
    
    results = []
    results.append(test_python_version())
    results.append(test_dependencies())
    results.append(test_env_file())
    results.append(test_imports())
    results.append(test_ai_agent())
    results.append(test_database())
    
    print("\n" + "=" * 50)
    passed = sum(results)
    total = len(results)
    
    if passed == total:
        print(f"🎉 All tests passed! ({passed}/{total})")
        print("\nYou're ready to start the server:")
        print("  python main.py")
    elif passed >= 4:
        print(f"⚠️  Most tests passed ({passed}/{total})")
        print("\nFix the issues above, then start the server:")
        print("  python main.py")
    else:
        print(f"❌ Several tests failed ({passed}/{total})")
        print("\nPlease fix the issues above before starting.")
    
    print()
    return all(results[:3])  # At minimum, Python, deps, and env must pass


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
