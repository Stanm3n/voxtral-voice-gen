@echo off
setlocal EnableDelayedExpansion

echo.
echo  ============================================================
echo   VOXTRAL VOICE GEN - Install
echo  ============================================================
echo.

:: ── Python check ────────────────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install from https://python.org
    pause & exit /b 1
)
for /f "tokens=2" %%v in ('python --version') do set PY_VER=%%v
echo [OK] Python !PY_VER!

:: ── Create venv ───────────────────────────────────────────────────────────
if not exist venv (
    echo [..] Creating virtual environment...
    python -m venv venv
    echo [OK] venv created
) else (
    echo [OK] venv already exists
)

:: ── Activate and install ──────────────────────────────────────────────────
call venv\Scripts\activate.bat
echo [..] Installing Python dependencies...
pip install --quiet --upgrade pip
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install --quiet -r backend\requirements.txt
if errorlevel 1 (
    echo [ERROR] pip install failed. Check your internet connection.
    pause & exit /b 1
)
echo [OK] Dependencies installed

:: ── Copy .env ─────────────────────────────────────────────────────────────
if not exist .env (
    copy .env.example .env >nul
    echo [OK] Created .env — edit if needed
) else (
    echo [OK] .env already exists
)

:: ── Docker check ──────────────────────────────────────────────────────────
docker --version >nul 2>&1
if errorlevel 1 (
    echo [WARN] Docker not found. Install Docker Desktop for GPU model serving.
) else (
    echo [OK] Docker found
)

echo.
echo  ============================================================
echo   Installation complete!
echo   Next steps:
echo     1. Start Docker Desktop
echo     2. Run: start.bat
echo  ============================================================
echo.
pause
