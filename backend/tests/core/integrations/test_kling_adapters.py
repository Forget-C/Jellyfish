"""可灵图片与视频适配器的 HTTP 映射及任务轮询测试。"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.contracts.image_generation import ImageGenerationInput, InputImageRef
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.image_capabilities import validate_image_options
from app.core.integrations.video_capabilities import validate_video_options
from app.core.integrations.kling.images import KlingImageApiAdapter
from app.core.integrations.kling.video import KlingVideoApiAdapter
from app.core.tasks.image_generation_tasks import KlingImageGenerationTask
from app.core.tasks.video_generation_tasks import KlingVideoGenerationTask


def _patch_httpx_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    """让可灵适配器使用 MockTransport，避免测试访问真实供应商。"""
    real_client = httpx.AsyncClient

    def factory(**kwargs: object) -> httpx.AsyncClient:
        return real_client(transport=transport, timeout=kwargs.get("timeout", 60.0))  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_kling_turbo_video_create_and_query(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turbo 文生视频应使用模型专属创建路径和统一视频查询路径。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("authorization") == "Bearer kling-key"
        if request.method == "POST":
            assert request.url.path == "/text-to-video/kling-3.0-turbo"
            body = json.loads(request.content.decode())
            assert body["prompt"] == "城市夜景"
            assert body["settings"] == {"aspect_ratio": "16:9", "duration": 5}
            assert body["options"]["watermark_info"]["enabled"] is False
            return httpx.Response(200, json={"code": 0, "data": {"id": "video-1"}})
        assert request.url.path == "/tasks"
        assert request.url.params["task_ids"] == "video-1"
        return httpx.Response(200, json={"code": 0, "data": [{"id": "video-1", "status": "succeeded"}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="kling", api_key="kling-key")
    inp = VideoGenerationInput(
        prompt="城市夜景", model="kling-3.0-turbo", ratio="16:9", seconds=5, watermark=False
    )
    adapter = KlingVideoApiAdapter()
    task_id = await adapter.create_video(cfg=cfg, input_=inp, timeout_s=30)
    assert task_id == "video-1"
    creation = await adapter.get_creation(cfg=cfg, task_id=task_id, timeout_s=30)
    assert creation["data"][0]["status"] == "succeeded"


@pytest.mark.asyncio
async def test_kling_omni_image_to_video_uses_contents(monkeypatch: pytest.MonkeyPatch) -> None:
    """Omni 图生视频应使用首帧 contents 项，不能混入项目关键帧。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/image-to-video/kling-3.0"
        body = json.loads(request.content.decode())
        assert body["contents"] == [
            {"type": "prompt", "text": "人物回头"},
            {"type": "first_frame", "url": "data:image/png;base64,frame"},
        ]
        return httpx.Response(200, json={"code": 0, "data": {"id": "video-2"}})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    task_id = await KlingVideoApiAdapter().create_video(
        cfg=ProviderConfig(provider="kling", api_key="kling-key"),
        input_=VideoGenerationInput(
            prompt="人物回头", model="kling-3.0", ratio="9:16", frame_references={"first_frame": "frame"}
        ),
        timeout_s=30,
    )
    assert task_id == "video-2"


@pytest.mark.asyncio
async def test_kling_image_create_and_query(monkeypatch: pytest.MonkeyPatch) -> None:
    """图片生成应使用 model_name、单图 image 与图片专用查询接口。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            assert request.url.path == "/v1/images/generations"
            body = json.loads(request.content.decode())
            assert body["model_name"] == "kling-v3"
            assert body["image"] == "raw-image"
            assert body["resolution"] == "2k"
            return httpx.Response(200, json={"code": 0, "data": {"task_id": "image-1"}})
        assert request.url.path == "/v1/images/generations/image-1"
        return httpx.Response(200, json={"code": 0, "data": {"task_status": "succeed"}})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="kling", api_key="kling-key")
    inp = ImageGenerationInput(
        prompt="一只猫",
        model="kling-v3",
        images=[InputImageRef(image_url="data:image/png;base64,raw-image")],
        resolution_profile="high",
    )
    adapter = KlingImageApiAdapter()
    task_id = await adapter.create_image(cfg=cfg, inp=inp, timeout_s=30)
    assert task_id == "image-1"
    creation = await adapter.get_creation(cfg=cfg, task_id=task_id, timeout_s=30)
    assert creation["data"]["task_status"] == "succeed"


@pytest.mark.asyncio
async def test_kling_video_task_normalizes_successful_output() -> None:
    """视频任务层应将可灵 outputs 视频 URL 转成项目通用结果。"""

    class Adapter:
        """模拟可灵视频创建与查询结果。"""

        async def create_video(self, **_: object) -> str:
            return "video-3"

        async def get_creation(self, **_: object) -> dict[str, object]:
            return {
                "data": [
                    {"status": "succeeded", "outputs": [{"type": "video", "url": "https://example/video.mp4"}]}
                ]
            }

    task = KlingVideoGenerationTask(
        adapter=Adapter(),  # type: ignore[arg-type]
        provider_config=ProviderConfig(provider="kling", api_key="key"),
        input_=VideoGenerationInput(prompt="城市", model="kling-3.0-turbo", ratio="16:9"),
        poll_interval_s=0,
    )
    await task.run()
    result = await task.get_result()
    assert result is not None
    assert result.provider == "kling"
    assert result.url == "https://example/video.mp4"


@pytest.mark.asyncio
async def test_kling_image_task_normalizes_successful_output() -> None:
    """图片任务层应将可灵 task_result.images 转成项目通用结果。"""

    class Adapter:
        """模拟可灵图片创建与查询结果。"""

        async def create_image(self, **_: object) -> str:
            return "image-2"

        async def get_creation(self, **_: object) -> dict[str, object]:
            return {
                "data": {
                    "task_status": "succeed",
                    "task_result": {"images": [{"url": "https://example/image.png"}]},
                }
            }

    task = KlingImageGenerationTask(
        adapter=Adapter(),  # type: ignore[arg-type]
        provider_config=ProviderConfig(provider="kling", api_key="key"),
        input_=ImageGenerationInput(prompt="猫", model="kling-v3"),
        poll_interval_s=0,
    )
    await task.run()
    result = await task.get_result()
    assert result is not None
    assert result.provider == "kling"
    assert result.images[0].url == "https://example/image.png"


def test_kling_capabilities_reject_unmapped_common_options() -> None:
    """能力矩阵应拒绝可灵当前接口未映射的 seed 与无效时长。"""
    with pytest.raises(ValueError, match="seed"):
        validate_video_options(
            provider="kling",
            model="kling-3.0-turbo",
            input_=VideoGenerationInput(prompt="城市", ratio="16:9", seed=1),
        )
    with pytest.raises(ValueError, match="seconds"):
        validate_video_options(
            provider="kling",
            model="kling-3.0",
            input_=VideoGenerationInput(prompt="城市", ratio="16:9", seconds=16),
        )
    validate_image_options(
        provider="kling",
        model="kling-v3",
        input_=ImageGenerationInput(prompt="猫", n=9, size="2k"),
    )
