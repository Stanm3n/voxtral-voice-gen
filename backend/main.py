"""Voxtral Voice Gen — FastAPI Backend"""
import os, time, logging, asyncio, base64
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Response, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

# Rate Limiting
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from backend.pipeline import stt, llm, tts, persistence

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

# ── Config ────────────────────────────────────────────────────────────────────
LLM_URL     = os.getenv("LLM_URL",     "http://localhost:8001/v1")
LLM_MODEL   = os.getenv("LLM_MODEL",   "/model")
LLM_API_KEY = os.getenv("LLM_API_KEY", "EMPTY")

VOXTRAL_URL   = os.getenv("VOXTRAL_URL",   "http://localhost:8002/v1")
VOXTRAL_VOICE = os.getenv("VOXTRAL_VOICE", "casual_male")
VOXTRAL_MODEL = os.getenv("VOXTRAL_MODEL", "/model")

WHISPER_DEVICE  = os.getenv("WHISPER_DEVICE",    "cuda")
WHISPER_GPU_IDX = int(os.getenv("WHISPER_GPU_INDEX", "1"))

SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "You are a concise, helpful voice assistant. Keep responses short and natural for speech. "
    "Avoid markdown and special characters since your output will be spoken aloud."
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
log = logging.getLogger("voicebot")

# ── Rate Limiter Setup ────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

@asynccontextmanager
async def lifespan(app: FastAPI):
    stt.init_whisper(WHISPER_DEVICE, WHISPER_GPU_IDX)
    yield


app = FastAPI(title="Voxtral Voice Gen", version="2.3.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Security: Hardened CORS ───────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",   # Live Server (Common IDE extension)
        "http://127.0.0.1:5500",
        "http://localhost:8000",   # Direct Backend access
        "http://127.0.0.1:8000"
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    import httpx
    status = {"llm": "loading", "voxtral": "loading", "whisper": "ok", "llm_model": LLM_MODEL}

    async def check(url: str, key: str):
        if url.startswith("https://api.") or url.startswith("https://openrouter."):
            status[key] = "ok"
            return
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                if (await client.get(url.replace("/v1", "/health"))).status_code == 200:
                    status[key] = "ok"
        except Exception:
            pass

    await asyncio.gather(check(LLM_URL, "llm"), check(VOXTRAL_URL, "voxtral"))
    return status


# ── STT ───────────────────────────────────────────────────────────────────────
@app.post("/stt")
@limiter.limit("10/minute")
async def speech_to_text(request: Request, audio: UploadFile = File(...)):
    # 1. Validation: Content-Type (with fallback for octet-stream/empty from some browsers)
    cpath = audio.content_type or ""
    if cpath and not cpath.startswith("audio/"):
        if cpath != "application/octet-stream":
             raise HTTPException(status_code=400, detail=f"Invalid file type: {cpath}")
    
    # 2. Validation: Size (25MB limit)
    content = await audio.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file too large (max 25MB)")
    
    res = await stt.transcribe(content)
    return {"text": res["transcript"], "duration_ms": res["duration_ms"]}


# ── TTS (used by TTS Test Mode in the frontend) ───────────────────────────────
@app.post("/tts")
@limiter.limit("20/minute")
async def text_to_speech(request: Request, body: dict):
    # 1. Validation: Text length (2000 chars)
    text = body.get("text", "")
    if len(text) > 2000:
        raise HTTPException(status_code=413, detail="Text input too long (max 2000 chars)")

    t0 = time.perf_counter()
    audio = await tts.synthesize(
        text,
        body.get("voice", VOXTRAL_VOICE),
        VOXTRAL_MODEL,
        VOXTRAL_URL,
    )
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"X-TTS-Duration-Ms": str(round((time.perf_counter() - t0) * 1000))},
    )


# ── Chat history ──────────────────────────────────────────────────────────────
@app.get("/chats")
async def get_chats():
    return persistence.load_chats()

@app.post("/chats")
async def save_chat(data: dict):
    chats = persistence.load_chats()
    for i, c in enumerate(chats):
        if c.get("id") == data.get("id"):
            chats[i] = data
            persistence.save_chats(chats)
            return {"status": "updated"}
    chats.insert(0, data)
    persistence.save_chats(chats)
    return {"status": "created"}

@app.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str):
    persistence.save_chats([c for c in persistence.load_chats() if c.get("id") != chat_id])
    return {"status": "deleted"}


# ── WebSocket chat ────────────────────────────────────────────────────────────
@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    # WebSocket handles its own flow; global Rate Limiting does not apply to active stream
    await websocket.accept()
    cancel_event = asyncio.Event()

    try:
        data       = await websocket.receive_json()
        req_voice  = data.get("voice", VOXTRAL_VOICE)
        sys_prompt = data.get("system_prompt") or SYSTEM_PROMPT
        messages   = [{"role": "system", "content": sys_prompt}] + data.get("messages", [])

        t0        = time.perf_counter()
        ttfb_ms   = 0
        full_text = ""

        async for msg in llm.stream_completion_ws(messages, LLM_MODEL, LLM_URL, LLM_API_KEY, cancel_event):
            if cancel_event.is_set():
                break
            if msg.get("type") == "error":
                await websocket.send_json(msg)
                return
            if msg.get("type") == "text":
                if not ttfb_ms:
                    ttfb_ms = round((time.perf_counter() - t0) * 1000)
                    await websocket.send_json({"type": "latency", "llm_ttfb_ms": ttfb_ms})
                if not msg.get("is_thinking", False):
                    full_text += msg["content"]
                await websocket.send_json(msg)

        if not full_text.strip() or cancel_event.is_set():
            await websocket.send_json({"type": "done"})
            return

        log.info("TTS: %d chars → single synthesis call", len(full_text))
        audio = await tts.synthesize(full_text, req_voice, VOXTRAL_MODEL, VOXTRAL_URL)
        if audio and not cancel_event.is_set():
            await websocket.send_json({
                "type": "audio",
                "pcm_base64": base64.b64encode(audio).decode(),
            })

        if not cancel_event.is_set():
            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        cancel_event.set()
    except Exception as e:
        log.error("WebSocket error: %s", e)
        cancel_event.set()
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── Static frontend ───────────────────────────────────────────────────────────
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
