# Voxtral Voice Gen

> A local speech synthesis pipeline built around Mistral's Voxtral-4B model.
> Built as a single-user portfolio project to demonstrate system integration, containerized ML serving, and async architecture.

[![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.113-teal?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Voxtral](https://img.shields.io/badge/TTS-Voxtral--4B-purple)](https://mistral.ai)
[![Docker](https://img.shields.io/badge/Infra-Docker-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Demo-Live--Preview-success?logo=github-pages&logoColor=white)](https://stanm3n.github.io/voxtral-voice-gen/)

---

## Overview

Voxtral Voice Gen is a single-user portfolio project exploring what it takes to run a
state-of-the-art neural text-to-speech engine entirely on local hardware.

**🎧 Live Demo:** [https://stanm3n.github.io/voxtral-voice-gen/](https://stanm3n.github.io/voxtral-voice-gen/)  
*9 multilingual voice samples (DE, EN, FR, IT) showcasing E-Learning, Customer Support, Clinical Reports, and more.*

The idea: structured text — from LLM outputs, reports, or knowledge bases — gets synthesized
into natural speech, with no cloud dependency and no data leaving the machine. Think of it
as a local alternative to services like ElevenLabs or Azure TTS, built from scratch to
understand what's actually happening under the hood.

The project demonstrates three distinct engineering competencies:

- **ML Serving:** Running a 4B-parameter multimodal model via a containerized OpenAI-compatible API
- **Async Backend Design:** A FastAPI server that coordinates multiple AI services without blocking
- **Pipeline Resilience:** Multi-stage input sanitization to prevent synthesis errors and model hallucinations

---

## Architecture

The system separates concerns into three independent layers. Each can be swapped or replaced without
affecting the others — a deliberate design choice that mirrors how production ML systems are structured.

```
Text / Voice Input
       │
       ▼
┌─────────────────┐
│  FastAPI Server │  ← Orchestration layer (async, non-blocking)
│   (main.py)     │
└────────┬────────┘
         │
   ┌─────┴──────┐
   │            │
   ▼            ▼
[LLM Layer]  [STT Layer]        ← Optional. Used in "Test Mode" only.
(Any OpenAI- (faster-whisper
compatible    + Silero VAD)
endpoint)
   │
   ▼
┌─────────────────────────────┐
│    Voxtral TTS Container    │  ← Core component. Served via vLLM-Omni (Docker).
│    (vLLM-Omni / Docker)     │
└─────────────────────────────┘
         │
         ▼
  Audio Stream → Browser (WebSocket, gapless PCM playback)
```

### Key Engineering Decisions

**Why a Docker container for TTS?**
Voxtral-4B requires a specialized inference runtime (`vLLM-Omni`) that exposes an OpenAI-compatible
audio endpoint. Containerizing this service isolates its dependencies, makes GPU allocation explicit,
allowing the backend to treat it as a stateless API — the same pattern used in cloud deployments.

**Why complete-response synthesis instead of chunked streaming?**
Chunked TTS (sentence-by-sentence) reduces time-to-first-audio but breaks prosodic consistency —
each chunk is synthesized without context from the previous one, producing audible tonal shifts
at sentence boundaries. For voice output where quality is the product, this tradeoff is unacceptable.
The architecture prioritizes output fidelity over raw latency.

**Why an async FastAPI backend?**
Whisper's transcription is synchronous and CPU/GPU-bound. Running it in an `asyncio` executor pool
keeps the FastAPI event loop unblocked, allowing WebSocket connections to remain responsive during
inference. This is the standard pattern for integrating synchronous ML workloads into async web servers.

---

## Modes

| Mode | Description |
| :--- | :--- |
| **Direct TTS** | Accepts text input and returns synthesized audio. Primary showcase of the engine. |
| **Test Mode** | Full pipeline: Microphone → Whisper STT → LLM → Voxtral TTS. Used for end-to-end validation. |

---

## Pipeline Resilience

Several failure modes in voice pipelines are non-obvious. This project addresses them explicitly:

| Failure Mode | Mitigation |
| :--- | :--- |
| Whisper hallucinations on silence | Silero VAD pre-gate drops silent audio before transcription |
| Repetitive hallucination loops | `condition_on_previous_text=False` in Whisper config |
| Residual hallucination artifacts | Curated blocklist filters output before it reaches the LLM |
| Reasoning tokens (`<think>`) spoken aloud | LLM stream parser strips reasoning content before TTS |
| Markdown/Unicode breaking TTS engine | Text cleaning layer normalizes input prior to synthesis |

---

## Multilingual & Cross-Lingual Support

**🌍 Live Demo:** [https://stanm3n.github.io/voxtral-voice-gen/](https://stanm3n.github.io/voxtral-voice-gen/)

Voxtral Voice Gen is natively designed for high-fidelity multilingual speech. The live demo showcases **9 voice samples** across **4 languages**:

| Language | Voice Type | Use Case |
| :--- | :--- | :--- |
| 🇩🇪 German | Male/Female | E-Learning, Smart Home, Legal Documents |
| 🇬🇧 English | Male/Female | E-Learning, Customer Support |
| 🇮🇹 Italian | Male | Clinical Reports, E-Learning |
| 🇫🇷 French | Female | E-Learning |

**Key Features:**
- **Native Language Support:** Full prosodic support for DE, EN, FR, IT
- **Zero-Shot Accents:** Generate text in language A with acoustic characteristics of language B
- **Cross-Lingual Synthesis:** Switch languages seamlessly within a single inference call
- **Multiple Voice Types:** Casual, Neutral, Professional, and Context-specific voices
- **Diarization Ready:** Backend architecture prepared for future multi-speaker extensions

The demo page includes interactive audio players showcasing:
- **Educational Content** (E-Learning modules in 4 languages)
- **Customer Service** (Order notifications, route updates)
- **Clinical Documentation** (Vital signs reports)
- **Legal Documents** (Contract terms, accessibility)
- **Smart Home Integration** (Voice assistant briefings)

---

---

## ⚠️ Important Setup Notes

**Hugging Face Token Requirements:**
- Some models on Hugging Face may require authentication tokens for download
- If you encounter download errors, create a Hugging Face account and generate an access token
- Set the `HF_TOKEN` environment variable before running `download_models.bat`:
  ```bash
  set HF_TOKEN=your_token_here
  download_models.bat
  ```

**Voice Presets & Sample Voices:**
- The Voxtral-4B model includes built-in voice presets (`casual_male`, `calm_female`, `de_male`)
- Additional voice samples can be found in the `docs/audio/` directory for testing
- To use custom voices, ensure they are properly formatted and placed in the model directory

**Troubleshooting Download Issues:**
- If `download_models.bat` fails, check your internet connection
- Some models may require manual download from Hugging Face
- Ensure you have sufficient disk space (~8GB for Voxtral-4B)
- Verify Docker Desktop is running before starting the services

---

## Setup

**Prerequisites:** Docker Desktop with NVIDIA Container Toolkit, Python 3.11, CUDA 12.1+

**1. Clone the repository**
```bash
git clone https://github.com/Stanm3n/voxtral-voice-gen
cd voxtral-voice-gen
```

**2. Download model weights**
Pulls the Voxtral-4B weights (~8GB) into the local `models/` directory:
```bash
download_models.bat
```

*If download fails, set your Hugging Face token: `set HF_TOKEN=your_token_here`*

**3. Install dependencies**
Creates a Python virtual environment, installs PyTorch with CUDA 12.1 support, and
generates a `.env` configuration file:
```bash
install.bat
```

**4. Configure environment**
```env
# TTS Engine
VOXTRAL_URL=http://localhost:8002/v1
TTS_GPU_ID=0

# Optional — LLM endpoint for Test Mode
LLM_URL=https://api.deepseek.com/v1
LLM_API_KEY=your_key_here
```

The LLM endpoint accepts any OpenAI-compatible API. LM Studio (local), vLLM (Docker GPT-OSS20b), DeepSeek, and
OpenRouter have been tested.

**5. Start**
```bash
start.bat
```
Starts the Voxtral Docker container and the FastAPI backend. Open `http://localhost:8000`.

---

## Hardware

| | Minimum | Tested |
| :--- | :--- | :--- |
| GPU | NVIDIA, 8GB VRAM | RTX 3090, RTX 4090 |
| RAM | 16GB | 96GB |
| OS | Windows 10/11 + Docker Desktop | Windows 11 |

> Single-GPU setup: set `TTS_GPU_ID=0`. The LLM and TTS services can share one card.

---

## Tech Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| Backend | FastAPI, Python `asyncio` | Request orchestration, WebSocket handling |
| TTS Engine | Voxtral-4B via vLLM-Omni | Neural speech synthesis |
| STT | faster-whisper + Silero VAD | Transcription with silence filtering |
| LLM | Any OpenAI-compatible endpoint | Text generation for Test Mode |
| Frontend | Vanilla JS, Web Audio API | Gapless PCM audio playback |
| Infra | Docker Compose, NVIDIA Container Toolkit | GPU service isolation |

---

## License

MIT — Built as a portfolio project.
