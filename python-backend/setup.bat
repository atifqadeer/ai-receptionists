@echo off
REM ============================================
REM AI Receptionist Hub - Windows Setup Script
REM ============================================

echo.
echo  =========================================
echo   AI Receptionist Hub - Local Setup
echo  =========================================
echo.

REM Check Python
echo [1/5] Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found. Please install Python 3.9+ from https://python.org
    pause
    exit /b 1
)
python --version
echo  OK

REM Create virtual environment
echo.
echo [2/5] Creating virtual environment...
python -m venv venv
if errorlevel 1 (
    echo  ERROR: Failed to create virtual environment
    pause
    exit /b 1
)
echo  OK

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Install dependencies
echo.
echo [3/5] Installing Python dependencies...
pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo  ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo  OK

REM Create .env file
echo.
echo [4/5] Setting up environment configuration...
if not exist .env (
    copy .env.example .env
    echo  Created .env file
    echo.
    echo  IMPORTANT: Edit .env and add your API keys!
) else (
    echo  .env file already exists
)

REM Create directories
echo.
echo [5/5] Creating directories...
if not exist data mkdir data
if not exist logs mkdir logs
if not exist credentials mkdir credentials
echo  OK

echo.
echo  =========================================
echo   Setup Complete!
echo  =========================================
echo.
echo  To start the server:
echo    venv\Scripts\activate
echo    python main.py
echo.
echo  API: http://localhost:8000
echo  Docs: http://localhost:8000/docs
echo.
pause
