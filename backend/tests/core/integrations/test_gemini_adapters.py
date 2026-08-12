"""Gemini integrations：httpx MockTransport 单测（不发起真实网络请求）。

覆盖真实调用中发现、且容易被误改回其他 provider 惯例的关键差异：
- 图片：走原生多模态 `generateContent`（不是 Imagen `:predict`，那个端点对新用户
  已下线），图片以 `inlineData`（base64）内联在响应里，没有可下载 URL。
- 视频：创建返回 Google 标准长时任务 `{"name": ...}`（不是 `id` 或 `request_id`），
  轮询同一个 `name` 路径直到 `done: true`；成功结果在
  `response.generateVideoResponse.generatedSamples[0].video.uri`；被安全过滤拦截时
  `done` 也是 `true` 但没有 samples，必须当失败处理，不能误判成功。
- 鉴权统一用 `x-goog-api-key` 请求头，不是 `Authorization: Bearer`。
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.integrations.gemini.images import GeminiImageApiAdapter
from app.core.integrations.gemini.video import GeminiVideoApiAdapter
from app.core.integrations.gemini.video_payload import build_create_video_body
from app.core.tasks.video_generation_tasks import GeminiVideoGenerationTask
from app.core.contracts.image_generation import ImageGenerationInput, InputImageRef
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput


def _patch_httpx_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    """让各 adapter 内 `import httpx` 后使用的 AsyncClient 走 MockTransport。"""

    real_client = httpx.AsyncClient

    def factory(**kwargs: object) -> httpx.AsyncClient:
        timeout = kwargs.get("timeout", 60.0)
        return real_client(transport=transport, timeout=timeout)  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_gemini_image_adapter_generate_content_text_only(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = request.content.decode()
        assert request.headers.get("x-goog-api-key") == "gm-test"
        assert "authorization" not in request.headers
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": "here you go"},
                                {"inlineData": {"mimeType": "image/png", "data": "abc123"}},
                            ]
                        }
                    }
                ]
            },
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="gemini", api_key="gm-test", base_url="https://generativelanguage.googleapis.com/v1beta")
    inp = ImageGenerationInput(prompt="a vet tech in a pharmacy closet")
    result = await GeminiImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=30.0)

    assert captured["path"].endswith("/models/gemini-2.5-flash-image:generateContent")
    body = json.loads(captured["body"])
    assert body["contents"][0]["parts"][0]["text"] == "a vet tech in a pharmacy closet"
    assert result.provider == "gemini"
    assert result.images[0].b64_json == "abc123"
    assert result.images[0].url is None


@pytest.mark.asyncio
async def test_gemini_image_adapter_includes_reference_image_from_data_url(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.content.decode()
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": "xyz"}}]}}]},
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="gemini", api_key="gm-test")
    inp = ImageGenerationInput(
        prompt="edit this",
        images=[InputImageRef(image_url="data:image/jpeg;base64,ZmFrZWJ5dGVz")],
    )
    await GeminiImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=30.0)

    body = json.loads(captured["body"])
    parts = body["contents"][0]["parts"]
    assert len(parts) == 2
    assert parts[1]["inlineData"] == {"mimeType": "image/jpeg", "data": "ZmFrZWJ5dGVz"}


@pytest.mark.asyncio
async def test_gemini_image_adapter_raises_when_no_inline_data(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "no image, sorry"}]}}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="gemini", api_key="gm-test")
    inp = ImageGenerationInput(prompt="x")
    with pytest.raises(RuntimeError, match="no inline image data"):
        await GeminiImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=30.0)


def test_build_create_video_body_default_model_no_reference() -> None:
    inp = VideoGenerationInput.model_validate({"prompt": "a cat runs", "ratio": "16:9"})
    body = build_create_video_body(inp)
    assert body["instances"][0]["prompt"] == "a cat runs"
    assert body["parameters"]["aspectRatio"] == "16:9"
    assert body["parameters"]["resolution"] == "720p"
    assert "image" not in body["instances"][0]


def test_build_create_video_body_includes_image_reference_strips_data_url_prefix() -> None:
    inp = VideoGenerationInput.model_validate(
        {
            "prompt": "Mara turns to face Theo",
            "ratio": "16:9",
            "key_frame_base64": "data:image/jpeg;base64,ZmFrZWJ5dGVz",
        }
    )
    body = build_create_video_body(inp)
    assert body["instances"][0]["image"] == {"bytesBase64Encoded": "ZmFrZWJ5dGVz", "mimeType": "image/jpeg"}


def test_build_create_video_body_wraps_raw_base64_default_mime() -> None:
    inp = VideoGenerationInput.model_validate({"prompt": "x", "ratio": "16:9", "first_frame_base64": "cmF3Ynl0ZXM="})
    body = build_create_video_body(inp)
    assert body["instances"][0]["image"] == {"bytesBase64Encoded": "cmF3Ynl0ZXM=", "mimeType": "image/jpeg"}


@pytest.mark.asyncio
async def test_gemini_video_create_returns_operation_name(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归测试：创建响应字段是 name（完整操作路径），不是 id 或 request_id。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/models/veo-3.1-lite-generate-preview:predictLongRunning")
        assert request.headers.get("x-goog-api-key") == "gm-test"
        return httpx.Response(200, json={"name": "models/veo-3.1-lite-generate-preview/operations/abc123"})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="gemini", api_key="gm-test", base_url="https://generativelanguage.googleapis.com/v1beta")
    inp = VideoGenerationInput.model_validate({"prompt": "a cat runs", "ratio": "16:9"})
    operation_name = await GeminiVideoApiAdapter().create_video(cfg=cfg, input_=inp, timeout_s=30.0)
    assert operation_name == "models/veo-3.1-lite-generate-preview/operations/abc123"


@pytest.mark.asyncio
async def test_gemini_video_get_operation_polls_full_name_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归测试：轮询路径是完整的 operation name，不是拼接 /videos/{id}。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path.endswith("/models/veo-3.1-lite-generate-preview/operations/abc123")
        return httpx.Response(200, json={"name": "models/veo-3.1-lite-generate-preview/operations/abc123", "done": True})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="gemini", api_key="gm-test", base_url="https://generativelanguage.googleapis.com/v1beta")
    meta = await GeminiVideoApiAdapter().get_operation(
        cfg=cfg, operation_name="models/veo-3.1-lite-generate-preview/operations/abc123", timeout_s=30.0
    )
    assert meta["done"] is True


@pytest.mark.asyncio
async def test_gemini_video_generation_task_end_to_end(monkeypatch: pytest.MonkeyPatch) -> None:
    """完整走一遍 GeminiVideoGenerationTask：create -> poll not-done -> poll done -> result。"""
    poll_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"name": "models/veo-3.1-lite-generate-preview/operations/xyz"})
        poll_count["n"] += 1
        if poll_count["n"] < 2:
            return httpx.Response(200, json={"done": False})
        return httpx.Response(
            200,
            json={
                "done": True,
                "response": {
                    "generateVideoResponse": {
                        "generatedSamples": [
                            {"video": {"uri": "https://generativelanguage.googleapis.com/v1beta/files/final:download?alt=media"}}
                        ]
                    }
                },
            },
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="gemini", api_key="gm-test", base_url="https://generativelanguage.googleapis.com/v1beta")
    inp = VideoGenerationInput.model_validate({"prompt": "a cat runs", "ratio": "16:9"})
    task = GeminiVideoGenerationTask(provider_config=cfg, input_=inp, poll_interval_s=0.01, timeout_s=30.0)
    await task.run()
    result = await task.get_result()
    assert result is not None
    assert result.url == "https://generativelanguage.googleapis.com/v1beta/files/final:download?alt=media"
    assert result.provider == "gemini"
    assert result.provider_task_id == "models/veo-3.1-lite-generate-preview/operations/xyz"


@pytest.mark.asyncio
async def test_gemini_video_generation_task_raises_when_rai_filtered(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归测试：done=true 但没有 samples（安全过滤拦截）必须当失败处理，不能当成功解析成空结果。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"name": "models/veo-3.1-lite-generate-preview/operations/blocked"})
        return httpx.Response(
            200,
            json={
                "done": True,
                "response": {
                    "generateVideoResponse": {
                        "raiMediaFilteredCount": 1,
                        "raiMediaFilteredReasons": ["We encountered an issue with the audio for your prompt..."],
                    }
                },
            },
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="gemini", api_key="gm-test", base_url="https://generativelanguage.googleapis.com/v1beta")
    inp = VideoGenerationInput.model_validate({"prompt": "a cat runs", "ratio": "16:9"})
    task = GeminiVideoGenerationTask(provider_config=cfg, input_=inp, poll_interval_s=0.01, timeout_s=30.0)
    await task.run()
    result = await task.get_result()
    status = await task.status()
    assert result is None
    assert "filtered" in status["error"]


@pytest.mark.asyncio
async def test_gemini_video_generation_task_raises_on_explicit_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"name": "models/veo-3.1-lite-generate-preview/operations/err"})
        return httpx.Response(200, json={"done": True, "error": {"code": 500, "message": "internal error"}})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="gemini", api_key="gm-test", base_url="https://generativelanguage.googleapis.com/v1beta")
    inp = VideoGenerationInput.model_validate({"prompt": "a cat runs", "ratio": "16:9"})
    task = GeminiVideoGenerationTask(provider_config=cfg, input_=inp, poll_interval_s=0.01, timeout_s=30.0)
    await task.run()
    result = await task.get_result()
    status = await task.status()
    assert result is None
    assert "internal error" in status["error"]
