@echo off
REM ============================================
REM  AI Receptionist - start backend + frontend
REM  Double-click this file, or run: start-app.bat
REM ============================================
cd /d "%~dp0"

if not exist "python-backend\.venv\Scripts\python.exe" (
    echo [ERROR] python-backend\.venv not found. Create it first:
    echo   cd python-backend
    echo   py -3.12 -m venv .venv
    echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing frontend packages...
    call npm install
)

echo Starting backend on http://localhost:8000 ...
start "AI Receptionist - Backend" cmd /k "cd /d "%~dp0python-backend" && .venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"

echo Starting frontend on http://localhost:3000 ...
start "AI Receptionist - Frontend" cmd /k "cd /d "%~dp0" && npm run dev"

timeout /t 6 /nobreak >nul
start "" http://localhost:3000

echo.
echo Both servers are starting in their own windows.
echo Close those windows (or press Ctrl+C in them) to stop the app.
