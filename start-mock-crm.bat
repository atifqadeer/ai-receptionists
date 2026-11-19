@echo off
REM ============================================
REM  Mock CRM - a pretend third-party CRM for testing (port 8100)
REM  The AI Receptionist fetches applicants from it:
REM  Settings > Calling > Call Voice & CRM > Fetch applicants from your CRM
REM ============================================
cd /d "%~dp0"
if not exist "python-backend\.venv\Scripts\python.exe" (
    echo [ERROR] python-backend\.venv not found. Run start-app.bat setup first.
    pause
    exit /b 1
)
title Mock CRM - port 8100
python-backend\.venv\Scripts\python.exe mock-crm\server.py
