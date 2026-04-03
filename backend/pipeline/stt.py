import os, time, asyncio, tempfile, logging, re
from typing import Dict
import torch

whisper_model = None
vad_model = None
vad_utils = None

log = logging.getLogger("voicebot.stt")

# Common Whisper hallucinations (English/German) based on Vexa-ai lists and common patterns.
# These will be blocked if the entire transcript matches one of these (case-insensitive).
HALLUCINATION_BLOCKLIST = [
    # English
    "Thank you", "Thanks for watching", "Please subscribe", "Bye bye", "Thank you.",
    "Okay.", "All right.", "Alright.", "Bye!", "you", "Thank you for watching.",
    "Thanks for watching!", "Watch next", "Subscribe now",
    # German
    "Vielen Dank", "Danke fürs Zuschauen", "Abonniert den Kanal", "Auf Wiedersehen",
    "Verschlüsselt durch", "Untertitel von", "Subtitle by", "Vielen Dank für Ihre Aufmerksamkeit",
    "Schönen Tag noch", "Tschüss", "Bis zum nächsten Mal"
]

def init_whisper(device: str, device_index: int):
    """Initialize Whisper and Silero VAD on the GPU."""
    global whisper_model, vad_model, vad_utils
    
    # 1. Silero VAD Initialization
    log.info(f"Loading Silero VAD on {device}:{device_index} …")
    try:
        # Load from torch hub (cached locally) directly to the target GPU
        model, utils = torch.hub.load(repo_or_dir='snakers4/silero-vad',
                                    model='silero_vad',
                                    force_reload=False,
                                    onnx=False)
        vad_model = model.to(f"{device}:{device_index}")
        vad_utils = utils
        log.info("✓ Silero VAD ready")
    except Exception as exc:
        log.warning(f"Silero VAD load failed (likely missing dependencies): {exc}")

    # 2. Whisper Initialization
    log.info(f"Loading faster-whisper medium on GPU {device_index} …")
    try:
        from faster_whisper import WhisperModel
        whisper_model = WhisperModel(
            "medium",
            device=device,
            device_index=device_index,
            compute_type="float16",
        )
        log.info("✓ Whisper medium ready")
    except Exception as exc:
        log.warning(f"Whisper load failed ({exc}) — Whisper STT disabled")

def _contains_speech(audio_path: str, threshold: float = 0.5) -> bool:
    """Uses Silero VAD to detect if speech is present in the audio file."""
    if vad_model is None or vad_utils is None:
        # Fallback if VAD failed to load — proceed to Whisper anyway
        return True
    
    try:
        from faster_whisper import decode_audio
        # We use faster-whisper's internal decoder for efficient PCM 16k processing
        audio = decode_audio(audio_path, sampling_rate=16000)
        audio_tensor = torch.from_numpy(audio).to(vad_model.device)
        
        get_speech_timestamps = vad_utils[0]
        # Detect speech chunks
        speech_timestamps = get_speech_timestamps(audio_tensor, vad_model, sampling_rate=16000, threshold=threshold)
        return len(speech_timestamps) > 0
    except Exception as e:
        log.error(f"VAD check failed: {e}")
        return True

def _sync_transcribe(path: str) -> str:
    """Synchronous transcription with VAD pre-gate and hallucination filters."""
    if whisper_model is None:
        return ""
    
    try:
        # 1. VAD Pre-Gate (Early Exit for silence)
        if not _contains_speech(path):
            log.info("STT: No speech detected by Silero VAD (Pre-Gate). Skipping Whisper inference.")
            return ""

        # 2. Transcription with condition_on_previous_text=False to avoid repeat hallucinations
        segments, _ = whisper_model.transcribe(
            path, 
            beam_size=5, 
            condition_on_previous_text=False
        )
        text = " ".join(seg.text for seg in segments).strip()

        # 3. Post-Filter: Check against the Blocklist
        # Strip trailing punctuation and whitespace for comparison
        clean_text = text.strip(".?! ")
        for block in HALLUCINATION_BLOCKLIST:
            if clean_text.lower() == block.lower():
                log.info(f"STT: Blocked common hallucination: '{text}'")
                return ""
                
        return text
    finally:
        try:
            if os.path.exists(path):
                os.unlink(path)
        except OSError:
            pass

async def transcribe(audio_bytes: bytes) -> Dict:
    """Entry point for speech-to-text conversion."""
    if whisper_model is None:
        return {"transcript": "", "duration_ms": 0}

    t0 = time.perf_counter()
    
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    loop = asyncio.get_running_loop()
    try:
        # Run synchronous parts in an executor to avoid blocking the FastAPI loop
        transcript = await loop.run_in_executor(None, _sync_transcribe, tmp_path)
        duration_ms = round((time.perf_counter() - t0) * 1000)
        return {"transcript": transcript, "duration_ms": duration_ms}
    except Exception as exc:
        log.error(f"STT pipeline error: {exc}")
        return {"transcript": "", "duration_ms": 0}
