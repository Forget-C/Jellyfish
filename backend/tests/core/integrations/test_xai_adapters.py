"""xAI integrations：httpx MockTransport 单测（不发起真实网络请求）。

覆盖两点真实调用中发现、且容易在未来被误改回 OpenAI 默认值的关键差异：
- 图片：请求/响应形状与 OpenAI 一致，但 provider 标识必须是 "xai" 而不是 "openai"。
- 视频：创建端点是 `/videos/generations`（不是 `/videos`），status 取值是
  `pending`/`done`（不是 `in_progress`/`completed`），结果 URL 来自轮询响应内联的
  `video.url`（不是二次请求或拼接固定路径）。
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.integrations.xai.images import XAIImageApiAdapter
from app.core.integrations.xai.video import XAIVideoApiAdapter
from app.core.integrations.xai.video_payload import build_create_video_body
from app.core.tasks.video_generation_tasks import XAIVideoGenerationTask
from app.core.contracts.image_generation import ImageGenerationInput
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
async def test_xai_image_adapter_generations_labels_provider_xai(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = request.content.decode()
        assert request.headers.get("authorization", "").startswith("Bearer ")
        return httpx.Response(
            200,
            json={"data": [{"url": "https://imgen.x.ai/xai-imgen/1.jpeg", "mime_type": "image/jpeg"}]},
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="xai", api_key="xai-test", base_url="https://api.x.ai/v1")
    inp = ImageGenerationInput(prompt="a vet tech in a pharmacy closet", model="grok-imagine-image", n=1)
    result = await XAIImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=30.0)

    assert captured["path"].endswith("/images/generations")
    body = json.loads(captured["body"])
    assert body["model"] == "grok-imagine-image"
    assert body["prompt"] == "a vet tech in a pharmacy closet"

    # This is the exact regression this test guards: without PROVIDER_LABEL, an inherited
    # OpenAIImageApiAdapter.generate() call would mislabel this "openai".
    assert result.provider == "xai"
    assert result.images[0].url == "https://imgen.x.ai/xai-imgen/1.jpeg"


def test_build_create_video_body_default_model_no_reference() -> None:
    inp = VideoGenerationInput.model_validate({"prompt": "a cat runs", "ratio": "16:9", "seconds": 8})
    body = build_create_video_body(inp)
    assert body["model"] == "grok-imagine-video-1.5"
    assert body["prompt"] == "a cat runs"
    assert body["duration"] == 8
    assert "image" not in body


def test_build_create_video_body_includes_image_reference() -> None:
    inp = VideoGenerationInput.model_validate(
        {
            "prompt": "Mara turns to face Theo",
            "ratio": "16:9",
            "model": "grok-imagine-video-1.5",
            "key_frame_base64": "https://imgen.x.ai/xai-imgen/keyframe.jpeg",
        }
    )
    body = build_create_video_body(inp)
    assert body["image"] == {"url": "https://imgen.x.ai/xai-imgen/keyframe.jpeg"}


def test_build_create_video_body_wraps_raw_base64_as_data_url() -> None:
    inp = VideoGenerationInput.model_validate(
        {"prompt": "x", "ratio": "16:9", "first_frame_base64": "YWJjMTIz"}
    )
    body = build_create_video_body(inp)
    assert body["image"]["url"] == "data:image/png;base64,YWJjMTIz"


@pytest.mark.asyncio
async def test_xai_video_create_posts_to_generations_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归测试：创建端点必须是 /videos/generations，不是 OpenAI 风格的 /videos。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/videos/generations")
        return httpx.Response(200, json={"request_id": "req-123"})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="xai", api_key="xai-test", base_url="https://api.x.ai/v1")
    inp = VideoGenerationInput.model_validate({"prompt": "a cat runs", "ratio": "16:9", "seconds": 8})
    request_id = await XAIVideoApiAdapter().create_video(cfg=cfg, input_=inp, timeout_s=30.0)
    assert request_id == "req-123"


@pytest.mark.asyncio
async def test_xai_video_get_parses_pending_and_done_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归测试：status 取值是 pending/done，视频地址内联在 video.url 里。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path.endswith("/videos/req-123")
        return httpx.Response(
            200,
            json={
                "status": "done",
                "video": {"url": "https://vidgen.x.ai/xai-vidgen-bucket/out.mp4", "duration": 8},
                "model": "grok-imagine-video-1.5",
            },
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="xai", api_key="xai-test", base_url="https://api.x.ai/v1")
    meta = await XAIVideoApiAdapter().get_video(cfg=cfg, video_id="req-123", timeout_s=30.0)
    assert meta["status"] == "done"
    assert meta["video"]["url"] == "https://vidgen.x.ai/xai-vidgen-bucket/out.mp4"


@pytest.mark.asyncio
async def test_xai_video_generation_task_end_to_end(monkeypatch: pytest.MonkeyPatch) -> None:
    """完整走一遍 XAIVideoGenerationTask：create -> poll pending -> poll done -> result。"""
    poll_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            assert request.url.path.endswith("/videos/generations")
            return httpx.Response(200, json={"request_id": "req-456"})
        poll_count["n"] += 1
        if poll_count["n"] < 2:
            return httpx.Response(200, json={"status": "pending", "progress": 50})
        return httpx.Response(
            200,
            json={"status": "done", "video": {"url": "https://vidgen.x.ai/final.mp4"}},
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="xai", api_key="xai-test", base_url="https://api.x.ai/v1")
    inp = VideoGenerationInput.model_validate({"prompt": "a cat runs", "ratio": "16:9", "seconds": 8})
    task = XAIVideoGenerationTask(provider_config=cfg, input_=inp, poll_interval_s=0.01, timeout_s=30.0)
    await task.run()
    result = await task.get_result()
    assert result is not None
    assert result.url == "https://vidgen.x.ai/final.mp4"
    assert result.provider == "xai"
    assert result.provider_task_id == "req-456"


@pytest.mark.asyncio
async def test_xai_video_generation_task_raises_on_failed_status(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"request_id": "req-789"})
        return httpx.Response(200, json={"status": "failed", "error": "moderation_rejected"})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="xai", api_key="xai-test", base_url="https://api.x.ai/v1")
    inp = VideoGenerationInput.model_validate({"prompt": "a cat runs", "ratio": "16:9", "seconds": 8})
    task = XAIVideoGenerationTask(provider_config=cfg, input_=inp, poll_interval_s=0.01, timeout_s=30.0)
    await task.run()
    result = await task.get_result()
    status = await task.status()
    assert result is None
    assert status["error"]
