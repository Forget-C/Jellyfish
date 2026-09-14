"""可灵图片与视频适配器的 HTTP 映射及任务轮询测试。"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.contracts.provider_media import ProviderImageInput as ImageGenerationInput, ProviderImageReference as InputImageRef
from app.core.integrations.media_provider import MediaProvider
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.provider_media import ProviderVideoInput as VideoGenerationInput, ProviderVideoFrames, ProviderVideoSubject
from app.core.integrations.image_capabilities import validate_image_options
from app.core.integrations.video_capabilities import validate_video_options


def _projected_video_input(
    *,
    prompt: str,
    model: str,
    ratio: str,
    first_frame: str | None = None,
) -> VideoGenerationInput:
    """构造仅在 Provider 调用期间存在的帧 Data URL 投影。"""
    return VideoGenerationInput(
        prompt=prompt,
        model=model,
        ratio=ratio,
        seconds=None,
        seed=None,
        watermark=None,
        frame_references=ProviderVideoFrames(
            first_frame=first_frame,
            last_frame=None,
            key_frames=[],
        ),
        subject_references=[],
    )


def _projected_image_reference(image_url: str) -> InputImageRef:
    """使用经过校验的执行期图片引用。"""
    return InputImageRef(image_url=image_url)



def _with_projected_images(
    input_: ImageGenerationInput, references: list[InputImageRef]
) -> ImageGenerationInput:
    """把执行期 Data URL 投影附加到已通过公共契约校验的图片输入。"""
    return input_.model_copy(update={"images": references})


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
        return httpx.Response(200, json={"code": 0, "data": [{"id": "video-1", "status": "succeeded", "outputs": [{"type": "video", "url": "https://example/video.mp4"}]}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="kling", api_key="kling-key")
    inp = VideoGenerationInput(
        prompt="城市夜景", model="kling-3.0-turbo", ratio="16:9", seconds=5, watermark=False
    )
    task_id = await _submit(cfg=cfg, input_=inp)
    assert task_id == "video-1"
    creation = await _poll(cfg=cfg, task_id=task_id)
    assert creation.status == "succeeded"


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
    task_id = await _submit(
        cfg=ProviderConfig(provider="kling", api_key="kling-key"),
        input_=_projected_video_input(
            prompt="人物回头", model="kling-3.0", ratio="9:16", first_frame="frame"
        ),
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
        return httpx.Response(200, json={"code": 0, "data": {"task_status": "succeed", "task_result": {"images": [{"url": "https://example/image.png"}]}}})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="kling", api_key="kling-key")
    inp = ImageGenerationInput(
        prompt="一只猫",
        model="kling-v3",
        resolution_profile="high",
    )
    inp = _with_projected_images(inp, [_projected_image_reference("data:image/png;base64,raw-image")])
    task_id = await _submit(cfg=cfg, input_=inp)
    assert task_id == "image-1"
    creation = await _poll(cfg=cfg, task_id=task_id, kind="image_generation")
    assert creation.status == "succeeded"


@pytest.mark.asyncio
async def test_kling_video_poll_normalizes_successful_output(monkeypatch) -> None:
    """新供应商入口直接归一化可灵查询结果。"""
    def handler(request):
        """返回可灵的嵌套结果结构。"""
        assert request.method == "GET"
        return httpx.Response(200, json={"data": [{"status": "succeeded", "outputs": [{"type": "video", "url": "https://example/video.mp4"}]}]})
    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    result = await _poll(cfg=ProviderConfig(provider="kling", api_key="key"), task_id="result-1", kind="video_generation")
    assert result.status == "succeeded"
    assert result.outputs[0].url == "https://example/video.mp4"



@pytest.mark.asyncio
async def test_kling_image_poll_normalizes_successful_output(monkeypatch) -> None:
    """新供应商入口直接归一化可灵查询结果。"""
    def handler(request):
        """返回可灵的嵌套结果结构。"""
        assert request.method == "GET"
        return httpx.Response(200, json={"data": {"task_status": "succeed", "task_result": {"images": [{"url": "https://example/image.png"}]}}})
    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    result = await _poll(cfg=ProviderConfig(provider="kling", api_key="key"), task_id="result-1", kind="image_generation")
    assert result.status == "succeeded"
    assert result.outputs[0].url == "https://example/image.png"



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

async def _submit(*, cfg, input_):
    """通过新供应商入口验证单次提交协议。"""
    async with httpx.AsyncClient() as client:
        return await MediaProvider(client).submit(cfg, input_)


async def _poll(*, cfg, task_id, kind="video_generation"):
    """通过新供应商入口验证一次状态观察及结果归一化。"""
    async with httpx.AsyncClient() as client:
        return await MediaProvider(client).poll(cfg, task_id=task_id, kind=kind)
