# Voxtral Voice Gen

> High-quality, local-first AI voice generation. No cloud. No latency tax. No data leaving your machine.

[![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.113-teal?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Voxtral](https://img.shields.io/badge/TTS-Voxtral--4B-purple)](https://mistral.ai)
[![Docker](https://img.shields.io/badge/Infra-Docker-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## What is this?

**Voxtral Voice Gen** is a professional showcase of a local-first speech synthesis pipeline. At its heart is the **Voxtral-4B** model — a neural engine capable of generating natural, high-fidelity speech without relying on external cloud APIs.

This project demonstrates:
1. **Raw TTS Performance:** Synthesizing long-form text with consistent prosody.
2. **"Test Mode" Pipeline:** A complete STT → LLM → TTS chain for testing the engine in interactive chat scenarios.
3. **Local Sovereignty:** Total privacy and zero operational costs.

---

## Key Features

- **Voxtral-4B Engine:** Served via high-performance `vLLM-Omni` (Docker).
- **Zero-Latency Pipeline:** Optimized for sub-second responses on consumer GPUs.
- **Pluggable LLM:** Connect any OpenAI-compatible API (LM Studio, DeepSeek, OpenRouter) to see the voice in action.
- **Reasoning Awareness:** Automatically hides `<think>` tokens from being spoken by the TTS.
- **Hallucination Protection:** Multi-stage VAD and blocklist filtering for the STT layer.

---

## Architecture

```
User Input (Text/Voice) → [Optional: LLM] → Voxtral TTS → Audio Stream
```

1. **Generation:** Text is cleaned (stripping markdown and reasoning blocks) and sent to the Voxtral container.
2. **Synthesis:** Voxtral generates raw PCM audio which is streamed back via WebSocket for gapless playback.
3. **Test Mode:** Enables a full voice loop (Microphone → Whisper → LLM → Voxtral) for end-to-end pipeline testing.

---

## Setup

**1. Clone and Configure**
```bash
git clone https://github.com/yourusername/voxtral-voice-gen
cd voxtral-voice-gen
```

**2. Download models**
Run the downloader to pull the Voxtral weights (~8GB) to the `models/` directory:
```bash
download_models.bat
```

**3. Install Dependencies**
```bash
install.bat
```
This creates a Python environment, installs PyTorch with CUDA 12.1 support, and initializes your `.env` configuration.

**4. Edit Configuration**
Open the generated `.env` and configure your GPU and optional LLM endpoint:
```env
# Core TTS Settings
VOXTRAL_URL=http://localhost:8002/v1
TTS_GPU_ID=0

# Optional: LLM for Test Mode
LLM_URL=https://api.deepseek.com/v1
LLM_API_KEY=your_key
```

**5. Start**
```bash
start.bat
```
This starts the Docker container for Voxtral and the FastAPI backend. Open `http://localhost:8000` to begin.

---

## Hardware Requirements

| GPU | VRAM | RAM | OS |
| :--- | :--- | :--- | :--- |
| NVIDIA RTX (required) | ~8GB (Minimum) | 16GB+ | Windows 10/11 + Docker Desktop |

> Tested on RTX 3090 / 4090. Works on a single GPU (set `TTS_GPU_ID=0`).

---

## License

MIT — Created for portfolio purposes.
