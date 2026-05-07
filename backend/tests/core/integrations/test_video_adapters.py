"""视频 integrations：httpx MockTransport 单测。"""

from __future__ import annotations

import json

import httpx
import pytest
from pydantic import ValidationError

from app.core.integrations.aliyun.dashscope_videos import DashScopeVideoApiAdapter
from app.core.integrations.openai.video import OpenAIVideoApiAdapter
from app.core.integrations.volcengine.video import VolcengineVideoApiAdapter
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput


def _patch_httpx_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    real_client = httpx.AsyncClient

    def factory(**kwargs: object) -> httpx.AsyncClient:
        timeout = kwargs.get("timeout", 60.0)
        return real_client(transport=transport, timeout=timeout)  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_openai_video_create_returns_id(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url).rstrip("/").endswith("/videos")
        payload = json.loads(request.content.decode())
        assert payload["ratio"] == "16:9"
        assert payload["seed"] == 42
        assert payload["watermark"] is False
        assert payload["seconds"] == "6"
        return httpx.Response(200, json={"id": "video-1"})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="openai", api_key="sk-test")
    inp = VideoGenerationInput.model_validate(
        {"prompt": "a cat", "ratio": "16:9", "seed": 42, "watermark": False, "seconds": 6}
    )
    vid = await OpenAIVideoApiAdapter().create_video(cfg=cfg, input_=inp, timeout_s=30.0)
    assert vid == "video-1"


@pytest.mark.asyncio
async def test_openai_video_get_returns_meta(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert "/videos/v-99" in str(request.url)
        return httpx.Response(200, json={"status": "completed", "id": "v-99"})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="openai", api_key="sk-test")
    meta = await OpenAIVideoApiAdapter().get_video(cfg=cfg, video_id="v-99", timeout_s=30.0)
    assert meta["status"] == "completed"


@pytest.mark.asyncio
async def test_volcengine_video_create_and_get(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            body = json.loads(request.content.decode())
            assert "content" in body
            assert body["ratio"] == "9:16"
            assert body["duration"] == 8
            assert body["seed"] == 7
            assert body["watermark"] is True
            return httpx.Response(200, json={"id": "t-1"})
        if request.method == "GET":
            assert "/contents/generations/tasks/t-1" in str(request.url)
            return httpx.Response(
                200,
                json={"status": "succeeded", "content": {"video_url": "https://v.example/out.mp4"}},
            )
        return httpx.Response(500)

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="volcengine", api_key="ak-test")
    inp = VideoGenerationInput.model_validate(
        {"prompt": "舞", "ratio": "9:16", "seconds": 8, "seed": 7, "watermark": True}
    )
    tid = await VolcengineVideoApiAdapter().create_contents_task(cfg=cfg, input_=inp, timeout_s=30.0)
    assert tid == "t-1"
    meta = await VolcengineVideoApiAdapter().get_contents_task(cfg=cfg, task_id=tid, timeout_s=30.0)
    assert meta["status"] == "succeeded"
    assert meta["content"]["video_url"] == "https://v.example/out.mp4"


@pytest.mark.asyncio
async def test_dashscope_video_create_and_get_task(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            assert str(request.url).endswith("/api/v1/services/aigc/video-generation/video-synthesis")
            assert request.headers.get("X-DashScope-Async") == "enable"
            payload = json.loads(request.content.decode())
            assert payload["model"] == "wanx2.1-t2v-plus"
            assert payload["input"]["prompt"] == "一只猫在奔跑"
            # 文生视频模型（名称含 t2v）：不应附带帧 media。
            assert "media" not in payload["input"]
            assert payload["parameters"]["duration"] == 6
            assert payload["parameters"]["size"] == "1280*720"
            assert payload["parameters"]["ratio"] == "16:9"
            return httpx.Response(200, json={"output": {"task_id": "task-123"}})
        if request.method == "GET":
            assert str(request.url).endswith("/api/v1/tasks/task-123")
            return httpx.Response(
                200,
                json={
                    "output": {
                        "task_status": "SUCCEEDED",
                        "video_url": "https://example.com/out.mp4",
                    }
                },
            )
        return httpx.Response(500)

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="aliyun_bailian", api_key="ak-test", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
    inp = VideoGenerationInput.model_validate({
        "prompt": "一只猫在奔跑",
        "ratio": "16:9",
        "seconds": 6,
        "model": "wanx2.1-t2v-plus",
        "key_frame_base64": "aGVsbG8=",
    })
    adapter = DashScopeVideoApiAdapter()
    task_id = await adapter.create_video_task(cfg=cfg, input_=inp, timeout_s=30.0)
    assert task_id == "task-123"
    meta = await adapter.get_video_task(cfg=cfg, task_id=task_id, timeout_s=30.0)
    assert meta["output"]["task_status"] == "SUCCEEDED"


@pytest.mark.asyncio
async def test_dashscope_i2v_media_uses_first_frame_type(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            payload = json.loads(request.content.decode())
            assert payload["model"] == "wanx2.6-i2v-flash"
            assert payload["input"]["media"][0]["type"] == "first_frame"
            assert payload["input"]["media"][0]["url"].startswith("data:image/png;base64,")
            return httpx.Response(200, json={"output": {"task_id": "task-i2v"}})
        return httpx.Response(500)

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="aliyun_bailian", api_key="ak-test", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
    inp = VideoGenerationInput.model_validate({
        "prompt": "镜头推进",
        "ratio": "16:9",
        "model": "wanx2.6-i2v-flash",
        "key_frame_base64": "aGVsbG8=",
    })
    task_id = await DashScopeVideoApiAdapter().create_video_task(cfg=cfg, input_=inp, timeout_s=30.0)
    assert task_id == "task-i2v"


@pytest.mark.asyncio
async def test_dashscope_kf2v_maps_first_and_last_frame_types(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            payload = json.loads(request.content.decode())
            assert payload["model"] == "wan2.2-kf2v-flash"
            media = payload["input"]["media"]
            assert len(media) == 2
            assert media[0]["type"] == "first_frame"
            assert media[1]["type"] == "last_frame"
            return httpx.Response(200, json={"output": {"task_id": "task-kf2v"}})
        return httpx.Response(500)

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="aliyun_bailian", api_key="ak-test", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
    inp = VideoGenerationInput.model_validate({
        "prompt": "过渡",
        "ratio": "16:9",
        "model": "wan2.2-kf2v-flash",
        "first_frame_base64": "Zmlyc3Q=",
        "last_frame_base64": "bGFzdA==",
    })
    task_id = await DashScopeVideoApiAdapter().create_video_task(cfg=cfg, input_=inp, timeout_s=30.0)
    assert task_id == "task-kf2v"


@pytest.mark.asyncio
async def test_dashscope_ambiguous_model_omits_image_media(monkeypatch: pytest.MonkeyPatch) -> None:
    """名称未包含 t2v/i2v 等关键字时，不得以帧图冒充图生视频（否则会触发百炼 media 校验错误）。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            payload = json.loads(request.content.decode())
            assert payload["model"] == "wan2.6-standard"
            assert "media" not in payload["input"]
            return httpx.Response(200, json={"output": {"task_id": "task-t2v-default"}})
        return httpx.Response(500)

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="aliyun_bailian", api_key="ak-test", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
    inp = VideoGenerationInput.model_validate({
        "prompt": "奔跑",
        "ratio": "16:9",
        "model": "wan2.6-standard",
        "key_frame_base64": "aGVsbG8=",
    })
    task_id = await DashScopeVideoApiAdapter().create_video_task(cfg=cfg, input_=inp, timeout_s=30.0)
    assert task_id == "task-t2v-default"


@pytest.mark.asyncio
async def test_dashscope_ref_video_model_raises_without_video_url() -> None:
    cfg = ProviderConfig(provider="aliyun_bailian", api_key="ak-test", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
    inp = VideoGenerationInput.model_validate({
        "prompt": "续写",
        "ratio": "16:9",
        "model": "wanx-v2v-demo",
        "key_frame_base64": "aGVsbG8=",
    })
    with pytest.raises(RuntimeError, match="参考视频"):
        await DashScopeVideoApiAdapter().create_video_task(cfg=cfg, input_=inp, timeout_s=30.0)


def test_video_input_seed_bounds_validation() -> None:
    # 边界值应可通过：-1 以及 uint32 最大值
    VideoGenerationInput.model_validate({"prompt": "ok", "ratio": "16:9", "seed": -1})
    VideoGenerationInput.model_validate({"prompt": "ok", "ratio": "16:9", "seed": 4294967295})

    # 越界值应被拒绝：小于 -1 或大于 uint32 最大值
    with pytest.raises(ValidationError):
        VideoGenerationInput.model_validate({"prompt": "bad", "ratio": "16:9", "seed": -2})
    with pytest.raises(ValidationError):
        VideoGenerationInput.model_validate({"prompt": "bad", "ratio": "16:9", "seed": 4294967296})
