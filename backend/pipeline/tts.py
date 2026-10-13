import re
import httpx
import logging

logger = logging.getLogger(__name__)


class SynthesisError(RuntimeError):
    """The speech service failed to return usable audio."""


def _clean_text(text: str) -> str:
    """Remove <think> blocks and markdown characters Voxtral would speak literally."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"[*#_~`]", "", text)
    text = re.sub(r"[\U00010000-\U0010ffff]", "", text)
    return text.strip()


async def synthesize(text: str, voice: str, model: str, api_url: str) -> bytes:
    """
    Synthesize text to speech via the Voxtral vLLM-Omni endpoint.
    Returns a complete WAV file as bytes; raises SynthesisError on failure.

    The full text is sent in a single request so Voxtral can maintain
    natural prosody across sentence boundaries.
    """
    text = _clean_text(text)
    if not text:
        raise ValueError("Text contains no speakable content.")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{api_url.rstrip('/')}/audio/speech",
                json={
                    "input":           text,
                    "model":           model,
                    "response_format": "wav",
                    "voice":           voice,
                },
            )
            resp.raise_for_status()
            if not resp.content:
                raise SynthesisError("Speech service returned empty audio.")
            return resp.content
    except SynthesisError:
        raise
    except Exception as exc:
        logger.error("TTS failed: %s", exc)
        raise SynthesisError("Speech service failed. Check the service status and logs.") from exc
