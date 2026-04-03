@echo off
setlocal EnableDelayedExpansion

echo.
echo  ============================================================
echo   VOXTRAL VOICE GEN - Start
echo  ============================================================
echo.

:: ── Environment check ────────────────────────────────────────────────────────
if not exist .env (
    echo.
    echo [ERROR] .env file not found!
    echo         Run install.bat first or copy .env.example to .env
    echo.
    pause & exit /b 1
)
echo [OK] .env configuration found

:: ── Docker Desktop check ──────────────────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Docker Desktop is not running!
    echo         Please start Docker Desktop, wait for it to fully load,
    echo         then run this script again.
    echo.
    pause
    exit /b 1
)
echo [OK] Docker Desktop is running

:: ── GPU passthrough test ──────────────────────────────────────────────────
echo [..] Testing GPU access in Docker...
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi -L > gpu_info.tmp 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] GPU passthrough failed!
    echo         In Docker Desktop: Settings -> Resources -> WSL Integration
    echo         Enable your WSL distro, then restart Docker Desktop.
    echo.
    pause
    exit /b 1
)

:: Dynamically list detected GPUs
for /f "tokens=1,2 delims=:" %%a in (gpu_info.tmp) do (
    set GPU_NAME=%%b
    set GPU_NAME=!GPU_NAME:~1!
    echo [OK] Detected: !GPU_NAME!
)
del gpu_info.tmp

:: ── Build images if not present ───────────────────────────────────────────
echo.
echo [..] Checking Docker images...
docker compose build
if errorlevel 1 (
    echo.
    echo [ERROR] Image compilation failed. Check the logs above.
    pause & exit /b 1
)
echo [OK] Docker images are ready.

:: ── Models check ──────────────────────────────────────────────────────────
if not exist "models\voxtral" (
    echo.
    echo [ERROR] Voxtral TTS model not found at models\voxtral\
    echo         Run download_models.bat first!
    echo.
    pause & exit /b 1
)

:: ── Start containers ──────────────────────────────────────────────────────
echo.
echo [..] Starting model containers...
docker compose up -d --remove-orphans
if errorlevel 1 (
    echo.
    echo [ERROR] docker compose up failed.
    echo.
    pause & exit /b 1
)
echo [OK] Containers started.

:: ── Python venv check ─────────────────────────────────────────────────────
if not exist venv (
    echo.
    echo [ERROR] Python venv not found. Run install.bat first!
    echo.
    pause & exit /b 1
)
call venv\Scripts\activate.bat

echo.
echo [..] Starting FastAPI backend on http://localhost:8000
echo      First load takes 1-3 minutes per model.
echo.
echo  Press CTRL+C to stop.
echo.

start "" http://localhost:8000
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
pause
