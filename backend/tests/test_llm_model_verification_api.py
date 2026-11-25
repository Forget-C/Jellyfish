"""Model management verifies actual upstream round trips and retains their configuration."""

from base64 import b64decode
from io import BytesIO
import json
import subprocess
from unittest.mock import patch
import wave

import httpx
from PIL import Image
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from tests.support.llm_api_app import build_llm_only_app


@pytest_asyncio.fixture
async def model_http(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'model-check.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def db_session():
        async with sessions.begin() as session:
            yield session

    app = build_llm_only_app()
    app.dependency_overrides[get_db] = db_session
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1/llm/") as client:
            assert (await client.post("providers", json={
                "id": "provider1", "provider_key": "openai", "name": "Managed endpoint",
                "base_url": "https://controlled.invalid/v1", "api_key": "fixture-key",
            })).status_code == 201
            assert (await client.post("models", json={
                "id": "model1", "category": "text", "name": "original-model", "provider_id": "provider1",
                "capability_profile": {"tool_calling": {"declaration": "supported", "source": "Original claim"}},
            })).status_code == 201
            yield client
    finally:
        await engine.dispose()


def _tool_reply(request, *, follow_through=True, calls_tool=True):
    payload = json.loads(request.content)
    assert request.url.path == "/v1/chat/completions"
    assert payload["model"] == "original-model"
    assert "capability_profile" not in payload
    messages = payload["messages"]
    if messages[-1]["role"] == "tool":
        assert messages[-1]["tool_call_id"] == "fixture-call"
        token = messages[-1]["content"]
        assert token and token not in str(messages[:-1])
        answer = {"content": token if follow_through else "I did not use the result"}
    elif calls_tool:
        function = payload["tools"][0]["function"]["name"]
        answer = {"tool_calls": [{
            "type": "function", "id": "fixture-call",
            "function": {"name": function, "arguments": "{}"},
        }]}
    else:
        answer = {"content": "I support tools"}
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", **answer}}]})


@pytest.mark.asyncio
@pytest.mark.parametrize("calls_tool,follow_through,expected", [
    (True, True, "passed"), (True, False, "failed"), (False, False, "failed"),
])
async def test_verification_requires_the_full_tool_round_trip(model_http, calls_tool, follow_through, expected):
    path = "models/model1/capability-verifications"
    assert (await model_http.get(path)).json().get("data") == []
    async def upstream(_transport, request):
        return _tool_reply(request, calls_tool=calls_tool, follow_through=follow_through)

    with patch.object(httpx.AsyncHTTPTransport, "handle_async_request", upstream):
        result = await model_http.post(path, json={"capability": "tool_calling"})
    assert result.status_code == 200, result.text
    data = result.json()["data"]
    assert data["outcome"] == expected
    assert data["current"]
    assert data["endpoint"] == "https://controlled.invalid/v1/chat/completions"
    assert data["tested_at"]
    assert "fixture-key" not in result.text

    assert (await model_http.patch("providers/provider1", json={"base_url": "https://new.invalid/v1"})).is_success
    previous, = (await model_http.get(path)).json()["data"]
    assert not previous["current"]
    assert previous["model_name"] == "original-model"
    assert previous["provider_name"] == "Managed endpoint"
    assert previous["endpoint"] == data["endpoint"]
    profile = (await model_http.get("models/model1")).json()["data"]["capability_profile"]
    assert profile["tool_calling"] == {"declaration": "supported", "source": "Original claim"}


def _color(pixel):
    return ("RED", "GREEN", "BLUE")[max(range(3), key=lambda channel: pixel[channel])]


def _observe_media(block):
    if block["type"] == "image_url":
        url = block["image_url"]["url"]
        assert url.startswith("data:image/png;base64,")
        with Image.open(BytesIO(b64decode(url.split(",", 1)[1]))) as image:
            return _color(image.getpixel((0, 0)))
    if block["type"] == "video_url":
        url = block["video_url"]["url"]
        assert url.startswith("data:video/mp4;base64,")
        decoded = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", "pipe:0", "-vf", "scale=2:2", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
            input=b64decode(url.split(",", 1)[1]), capture_output=True, check=True, timeout=10,
        ).stdout
        frame_size = 2 * 2 * 3
        colors = []
        for i in range(0, len(decoded), frame_size):
            color = _color(decoded[i:i + 3])
            if not colors or colors[-1] != color:
                colors.append(color)
        return " ".join(colors)
    assert block["type"] == "input_audio" and block["input_audio"]["format"] == "wav"
    with wave.open(BytesIO(b64decode(block["input_audio"]["data"]))) as audio:
        chunk_size = audio.getframerate() // 10
        sounds = [any(audio.readframes(chunk_size)) for _ in range(audio.getnframes() // chunk_size)]
    return str(sum(current and not before for before, current in zip([False, *sounds], sounds)))


@pytest.mark.asyncio
@pytest.mark.parametrize("capability,media_type,upstream_mode,expected_reason", [
    ("image_inputs", "image_url", "observe", "verified"),
    ("video_inputs", "video_url", "observe", "verified"),
    ("audio_inputs", "input_audio", "observe", "verified"),
    ("video_inputs", "video_url", "static_only", "expected_observation_missing"),
    ("audio_inputs", "input_audio", "error", "request_failed"),
])
async def test_media_verification_requires_observation(model_http, capability, media_type, upstream_mode, expected_reason):
    async def upstream(_transport, request):
        content = json.loads(request.content)["messages"][0]["content"]
        blocks = [block for block in content if block["type"] != "text"]
        media, = blocks
        assert media["type"] == media_type
        if upstream_mode == "error":
            return httpx.Response(400, json={"error": "arbitrary provider error with secrets"})
        observed = _observe_media(media)
        answer = observed if upstream_mode == "observe" else observed.split()[0]
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": answer}}]})

    with patch.object(httpx.AsyncHTTPTransport, "handle_async_request", upstream):
        result = await model_http.post("models/model1/capability-verifications", json={"capability": capability})
    assert result.status_code == 200, result.text
    assert result.json()["data"]["reason"] == expected_reason
    assert "arbitrary provider error" not in result.text


@pytest.mark.asyncio
async def test_omni_uses_streamed_text_for_the_audio_observation(model_http):
    assert (await model_http.post("providers", json={
        "id": "bailian", "name": "Bailian", "provider_key": "aliyun_bailian",
        "base_url": "https://controlled.invalid/compatible-mode/v1", "api_key": "fixture-key",
    })).status_code == 201
    assert (await model_http.patch("models/model1", json={
        "name": "qwen3.8-omni-flash", "provider_id": "bailian",
    })).status_code == 200

    async def upstream(_transport, request):
        payload = json.loads(request.content)
        assert payload["stream"] and payload["modalities"] == ["text"]
        assert payload["reasoning_effort"] == "none"
        media = payload["messages"][0]["content"][1]
        data = media["input_audio"]["data"]
        assert data.startswith("data:audio/wav;base64,")
        media["input_audio"]["data"] = data.split(",", 1)[1]
        observation = _observe_media(media)
        event = json.dumps({"choices": [{"delta": {"content": observation}}]})
        return httpx.Response(200, text=f"data: {event}\n\ndata: [DONE]\n\n")

    with patch.object(httpx.AsyncHTTPTransport, "handle_async_request", upstream):
        result = await model_http.post("models/model1/capability-verifications", json={"capability": "audio_inputs"})
    assert result.json()["data"]["outcome"] == "passed", result.text


@pytest.mark.asyncio
async def test_responses_only_gateway_verifies_tool_results(model_http):
    assert (await model_http.patch("models/model1", json={"params": {"use_responses_api": True}})).is_success
    requests = []

    async def upstream(_transport, request):
        assert request.url.path == "/v1/responses"
        payload = json.loads(request.content)
        requests.append(payload)
        if len(requests) == 1:
            output = [{"type": "function_call", "call_id": "c1", "name": payload["tools"][0]["name"], "arguments": "{}"}]
        else:
            result = payload["input"][-1]
            assert result["type"] == "function_call_output" and result["call_id"] == "c1"
            output = [{"type": "message", "content": [{"type": "output_text", "text": result["output"]}]}]
        return httpx.Response(200, json={"status": "completed", "output": output})

    with patch.object(httpx.AsyncHTTPTransport, "handle_async_request", upstream):
        result = await model_http.post("models/model1/capability-verifications", json={"capability": "tool_calling"})
    assert result.json()["data"]["reason"] == "verified"
    assert result.json()["data"]["endpoint"].endswith("/responses")
    assert len(requests) == 2
