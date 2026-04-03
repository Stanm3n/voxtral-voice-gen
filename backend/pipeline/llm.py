import json
import httpx
import logging
import asyncio
from typing import AsyncGenerator, List, Dict, Any

log = logging.getLogger("voicebot.llm")


async def stream_completion_ws(
    messages: List[Dict[str, Any]],
    model: str,
    api_url: str,
    api_key: str,
    cancel_event: asyncio.Event,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Stream a chat completion from any OpenAI-compatible endpoint.

    Yields dicts of two types:
      {"type": "text", "content": str, "is_thinking": bool}
      {"type": "error", "message": str}

    Handles both native reasoning_content fields (DeepSeek)
    and inline <think>…</think> tags (Qwen, etc.).
    """
    inside_think = False

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{api_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model":       model,
                    "messages":    messages,
                    "temperature": 0.7,
                    "max_tokens":  2048,
                    "stream":      True,
                },
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if cancel_event.is_set():
                        break
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk   = json.loads(payload)
                        delta   = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "") or ""
                        reasoning = (
                            delta.get("reasoning_content", "")
                            or delta.get("reasoning", "")
                            or ""
                        )

                        if reasoning:
                            yield {"type": "text", "content": reasoning, "is_thinking": True}

                        if content:
                            if "<think>" in content:
                                pre = content.split("<think>")[0]
                                if pre:
                                    yield {"type": "text", "content": pre, "is_thinking": False}
                                inside_think = True
                            elif "</think>" in content:
                                post = content.split("</think>", 1)[-1]
                                if post:
                                    yield {"type": "text", "content": post, "is_thinking": False}
                                inside_think = False
                            else:
                                yield {"type": "text", "content": content, "is_thinking": inside_think}

                    except Exception:
                        continue

    except Exception as exc:
        log.error("LLM stream failed: %s", exc)
        yield {"type": "error", "message": str(exc)}
