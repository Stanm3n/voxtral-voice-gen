@echo off
setlocal EnableDelayedExpansion

echo.
echo  ============================================================
echo   VOXTRAL VOICEBOT - Download Models
echo  ============================================================

:: Check for Python venv
if not exist "venv\Scripts\python.exe" (
    echo [ERROR] Python venv not found! Run install.bat first.
    pause
    exit /b 1
)
set PY=venv\Scripts\python.exe

:: Install requirements for download
echo [..] Checking download requirements...
%PY% -m pip install -q huggingface_hub hf_transfer >nul 2>&1

:: Enable high-speed transfer
set HF_HUB_ENABLE_HF_TRANSFER=1

:: ── 1. Voxtral-4B (TTS) ──────────────────────────────────────────────────
echo.
echo [1/1] Downloading Voxtral-4B (TTS)...
if not exist "models\voxtral" mkdir "models\voxtral"
%PY% -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='mistralai/Voxtral-4B-TTS-2603', local_dir='models/voxtral', ignore_patterns=['*.bin', '*.pt', '*.pth'])"

if errorlevel 1 (
    echo.
    echo [ERROR] Download failed. Check your internet connection.
    pause & exit /b 1
)

echo.
echo [OK] All models downloaded successfully.
echo.
pause
