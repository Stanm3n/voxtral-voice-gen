"""Service regressions using real HTTP routes and mocked model/network calls."""
import base64
import importlib
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi.testclient import TestClient

with patch.dict(sys.modules, {"torch": MagicMock()}):
    main = importlib.import_module("backend.main")
    stt = main.stt
    tts = main.tts

RealAsyncClient = httpx.AsyncClient


def network(handler):
    transport = httpx.MockTransport(handler)
    return patch.object(httpx, "AsyncClient", side_effect=lambda *args, **kwargs: RealAsyncClient(*args, transport=transport, **kwargs))


class ServiceRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main.limiter._storage.reset()
        self.config = patch.multiple(main, LLM_URL="https://api.example.test/v1", LLM_MODEL="test-model", LLM_API_KEY="test-key", VOXTRAL_URL="http://localhost:8002/v1")
        self.config.start()

    def tearDown(self):
        self.config.stop()
        self.client.close()

    def test_health_checks_cloud_auth_and_loaded_whisper(self):
        calls = []
        def respond(request):
            calls.append(request)
            if request.url.path == "/v1/models":
                self.assertEqual(request.headers["Authorization"], "Bearer test-key")
                return httpx.Response(200, json={"data": [{"id": "test-model"}]})
            return httpx.Response(200)
        with network(respond), patch.object(stt, "whisper_model", object()):
            result = self.client.get("/health").json()
        self.assertEqual((result["llm"], result["voxtral"], result["whisper"]), ("ok", "ok", "ok"))
        self.assertEqual({r.url.path for r in calls}, {"/v1/models", "/health"})

    def test_health_does_not_claim_failed_services_are_ready(self):
        with network(lambda request: httpx.Response(401)), patch.object(stt, "whisper_model", None):
            result = self.client.get("/health").json()
        self.assertEqual((result["llm"], result["voxtral"], result["whisper"]), ("offline", "offline", "offline"))

    def test_health_requires_configured_model_in_model_list(self):
        def respond(request):
            return httpx.Response(200, json={"data": [{"id": "different-model"}]})
        with network(respond):
            self.assertEqual(self.client.get("/health").json()["llm"], "offline")

    def test_health_handles_network_timeouts(self):
        def respond(request):
            raise httpx.ReadTimeout("timeout", request=request)
        with network(respond):
            result = self.client.get("/health").json()
        self.assertEqual((result["llm"], result["voxtral"]), ("offline", "offline"))

    def test_tts_returns_audio_on_success(self):
        with network(lambda request: httpx.Response(200, content=b"RIFF-test-audio")):
            result = self.client.post("/tts", json={"text": "Hello"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.content, b"RIFF-test-audio")
        self.assertEqual(result.headers["content-type"], "audio/wav")

    def test_tts_upstream_http_failure_is_502_without_provider_details(self):
        with network(lambda request: httpx.Response(500, text="private provider details")):
            result = self.client.post("/tts", json={"text": "Hello"})
        self.assertEqual(result.status_code, 502)
        self.assertNotIn("private provider details", result.text)

    def test_tts_empty_audio_is_an_error(self):
        with network(lambda request: httpx.Response(200, content=b"")):
            result = self.client.post("/tts", json={"text": "Hello"})
        self.assertEqual(result.status_code, 502)
        self.assertIn("empty audio", result.json()["detail"])

    def test_tts_network_failure_is_an_error(self):
        def respond(request):
            raise httpx.ConnectError("service down", request=request)
        with network(respond):
            result = self.client.post("/tts", json={"text": "Hello"})
        self.assertEqual(result.status_code, 502)

    def test_tts_rejects_invalid_or_unspeakable_text_before_network_access(self):
        with network(lambda request: self.fail("Invalid text must not reach TTS")):
            for text in [None, 123, "", "  ", "<think>hidden</think>", "***"]:
                with self.subTest(text=text):
                    self.assertEqual(self.client.post("/tts", json={"text": text}).status_code, 400)

    def test_tts_rejects_overlong_text(self):
        self.assertEqual(self.client.post("/tts", json={"text": "a" * 2001}).status_code, 413)

    def test_missing_whisper_returns_503(self):
        with patch.object(stt, "whisper_model", None):
            result = self.client.post("/stt", files={"audio": ("sample.wav", b"audio", "audio/wav")})
        self.assertEqual(result.status_code, 503)

    def test_transcription_failure_returns_502(self):
        model = MagicMock()
        model.transcribe.side_effect = RuntimeError("private inference failure")
        with patch.object(stt, "whisper_model", model), patch.object(stt, "_contains_speech", return_value=True):
            result = self.client.post("/stt", files={"audio": ("sample.wav", b"audio", "audio/wav")})
        self.assertEqual(result.status_code, 502)
        self.assertNotIn("private inference failure", result.text)

    def test_silence_remains_a_successful_empty_transcription(self):
        with patch.object(stt, "whisper_model", object()), patch.object(stt, "_contains_speech", return_value=False):
            result = self.client.post("/stt", files={"audio": ("sample.wav", b"audio", "audio/wav")})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["text"], "")

    def test_websocket_reports_synthesis_failure(self):
        async def reply(*args):
            yield {"type": "text", "content": "Hello", "is_thinking": False}
        with patch.object(main.llm, "stream_completion_ws", reply), patch.object(tts, "synthesize", AsyncMock(side_effect=tts.SynthesisError("Speech service failed."))):
            with self.client.websocket_connect("/ws/chat") as ws:
                ws.send_json({"messages": [{"role": "user", "content": "Hi"}]})
                messages = [ws.receive_json() for _ in range(3)]
        self.assertEqual([m["type"] for m in messages], ["latency", "text", "error"])

    def test_websocket_excludes_reasoning_from_spoken_text(self):
        async def reply(*args):
            yield {"type": "text", "content": "hidden reasoning", "is_thinking": True}
            yield {"type": "text", "content": "Hello", "is_thinking": False}
        synthesis = AsyncMock(return_value=b"RIFF-test-audio")
        with patch.object(main.llm, "stream_completion_ws", reply), patch.object(tts, "synthesize", synthesis):
            with self.client.websocket_connect("/ws/chat") as ws:
                ws.send_json({"messages": []})
                messages = []
                while not messages or messages[-1]["type"] != "done":
                    messages.append(ws.receive_json())
        self.assertEqual(synthesis.call_args.args[0], "Hello")
        audio = next(m for m in messages if m["type"] == "audio")
        self.assertEqual(base64.b64decode(audio["pcm_base64"]), b"RIFF-test-audio")


class SpeechCleanupTests(unittest.TestCase):
    def test_text_cleaning_keeps_spoken_content(self):
        self.assertEqual(tts._clean_text("<think>hidden</think> **Hello** 🌍"), "Hello")

    def test_initialization_failure_clears_old_model_references(self):
        with patch.object(stt, "torch", MagicMock()) as torch, patch.dict(sys.modules, {"faster_whisper": MagicMock()}):
            stt.whisper_model = object()
            stt.vad_model = object()
            stt.vad_utils = object()
            torch.hub.load.side_effect = RuntimeError("VAD unavailable")
            sys.modules["faster_whisper"].WhisperModel.side_effect = RuntimeError("Whisper unavailable")
            stt.init_whisper("cuda", 0)
            self.assertIsNone(stt.whisper_model)
            self.assertIsNone(stt.vad_model)
            self.assertIsNone(stt.vad_utils)


if __name__ == "__main__":
    unittest.main()
