"""视频 integrations：httpx MockTransport 单测。"""

from __future__ import annotations

import json

import httpx
import pytest
from pydantic import ValidationError

from app.core.integrations.vidu.video_payload import build_create_video_request
from app.core.integrations.media_provider import MediaProvider
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.provider_media import ProviderVideoInput as VideoGenerationInput, ProviderVideoFrames, ProviderVideoSubject


def _projected_video_input(
    *,
    prompt: str,
    model: str,
    ratio: str,
    first_frame: str | None = None,
    last_frame: str | None = None,
    key_frames: list[str] | None = None,
    subject_references: list[ProviderVideoSubject] | None = None,
) -> VideoGenerationInput:
    """构造仅在 Provider 调用期间存在的媒体 URL/Data URL 投影。"""
    return VideoGenerationInput(
        prompt=prompt,
        model=model,
        ratio=ratio,
        seconds=None,
        seed=None,
        watermark=None,
        frame_references=ProviderVideoFrames(
            first_frame=first_frame,
            last_frame=last_frame,
            key_frames=key_frames or [],
        ),
        subject_references=subject_references or [],
    )


def _projected_subject(*, name: str, images=None, videos=None) -> ProviderVideoSubject:
    """以执行期 DTO 保留命名主体和媒体类型。"""
    return ProviderVideoSubject(name=name, images=images or [], videos=videos or [])



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
    vid = await _submit(cfg=cfg, input_=inp)
    assert vid == "video-1"


@pytest.mark.asyncio
async def test_openai_video_get_returns_meta(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert "/videos/v-99" in str(request.url)
        return httpx.Response(200, json={"status": "completed", "id": "v-99"})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="openai", api_key="sk-test")
    meta = await _poll(cfg=cfg, task_id="v-99")
    assert meta.status == "succeeded"


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
    tid = await _submit(cfg=cfg, input_=inp)
    assert tid == "t-1"
    meta = await _poll(cfg=cfg, task_id=tid)
    assert meta.status == "succeeded"
    assert meta.outputs[0].url == "https://v.example/out.mp4"


@pytest.mark.asyncio
async def test_vidu_video_create_and_get(monkeypatch: pytest.MonkeyPatch) -> None:
    """首尾帧输入应选择 Vidu start-end2video，并使用 Token 鉴权。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("authorization") == "Token vidu-key"
        if request.method == "POST":
            assert request.url.path.endswith("/ent/v2/start-end2video")
            body = json.loads(request.content.decode())
            assert body["images"] == [
                "data:image/png;base64,first",
                "data:image/png;base64,last",
            ]
            return httpx.Response(200, json={"task_id": "vidu-video-1", "state": "created"})
        assert request.url.path.endswith("/ent/v2/tasks/vidu-video-1/creations")
        return httpx.Response(200, json={"state": "success", "creations": [{"url": "https://vidu.example/out.mp4"}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="vidu", api_key="vidu-key")
    inp = _projected_video_input(
        prompt="a transition",
        model="viduq2",
        ratio="16:9",
        first_frame="first",
        last_frame="last",
    )
    task_id = await _submit(cfg=cfg, input_=inp)
    assert task_id == "vidu-video-1"
    creation = await _poll(cfg=cfg, task_id=task_id)
    assert creation.status == "succeeded"


def test_vidu_video_payload_selects_text_and_reference_endpoints() -> None:
    """无参考帧走文本端点，多图参考走 reference2video。"""
    text_path, _ = build_create_video_request(
        VideoGenerationInput(prompt="a city", model="viduq2", ratio="16:9")
    )
    reference_path, reference_body = build_create_video_request(
        _projected_video_input(
            prompt="same character",
            model="viduq2",
            ratio="16:9",
            first_frame="first",
            key_frames=["key"],
        )
    )
    assert text_path == "/ent/v2/text2video"
    assert reference_path == "/ent/v2/reference2video"
    assert reference_body["images"] == ["data:image/png;base64,first", "data:image/png;base64,key"]


def test_vidu_video_payload_keeps_subject_references_separate_from_frames() -> None:
    """主体图片/视频应映射到 Vidu subjects，而不是顶层帧 images/videos。"""
    path, body = build_create_video_request(
        _projected_video_input(
            prompt="@hero 与 @pet 在花园散步",
            model="viduq2-pro",
            ratio="16:9",
            subject_references=[
                _projected_subject(name="hero", images=["https://cdn.example/hero.png"]),
                _projected_subject(name="pet", videos=["https://cdn.example/pet.mp4"]),
            ],
        )
    )
    assert path == "/ent/v2/reference2video"
    assert body["subjects"] == [
        {"name": "hero", "images": ["https://cdn.example/hero.png"]},
        {"name": "pet", "videos": ["https://cdn.example/pet.mp4"]},
    ]
    assert "images" not in body
    assert "videos" not in body


@pytest.mark.asyncio
async def test_vidu_video_poll_normalizes_creation(monkeypatch) -> None:
    """Vidu 视频查询输出归一化为待收取的视频地址。"""
    def handler(request):
        """模拟单次查询。"""
        assert request.method == "GET"
        return httpx.Response(200, json={"state": "success", "creations": [{"url": "https://vidu.example/video.mp4"}]})
    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    result = await _poll(cfg=ProviderConfig(provider="vidu", api_key="key"), task_id="video-2")
    assert result.status == "succeeded"
    assert result.outputs[0].url == "https://vidu.example/video.mp4"



def test_video_input_seed_bounds_validation() -> None:
    # 边界值应可通过：-1 以及 uint32 最大值
    VideoGenerationInput.model_validate({"prompt": "ok", "ratio": "16:9", "seed": -1})
    VideoGenerationInput.model_validate({"prompt": "ok", "ratio": "16:9", "seed": 4294967295})

    # 越界值应被拒绝：小于 -1 或大于 uint32 最大值
    with pytest.raises(ValidationError):
        VideoGenerationInput.model_validate({"prompt": "bad", "ratio": "16:9", "seed": -2})
    with pytest.raises(ValidationError):
        VideoGenerationInput.model_validate({"prompt": "bad", "ratio": "16:9", "seed": 4294967296})

async def _submit(*, cfg, input_):
    """通过新供应商入口验证单次提交协议。"""
    async with httpx.AsyncClient() as client:
        return await MediaProvider(client).submit(cfg, input_)


async def _poll(*, cfg, task_id, kind="video_generation"):
    """通过新供应商入口验证一次状态观察及结果归一化。"""
    async with httpx.AsyncClient() as client:
        return await MediaProvider(client).poll(cfg, task_id=task_id, kind=kind)
