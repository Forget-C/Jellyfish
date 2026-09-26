"""断点④·声音侧：把镜头绑定的声音接进视频生成入参。

关键边界（决定了这里的断言为什么这么写）：

- APIMart / seedance 协议只有 ``generate_audio``（布尔开关，让模型自带音频），
  **没有"上传音频"字段**。所以我们**不能**假装上传的配音会随请求发出去。
- 契约与接线都做了，但只在 ``supports_audio_input=True`` 时才会真的发；
  APIMart 为 False，因此上层必须给出**明确提示**，不能静默丢弃。
"""

from __future__ import annotations

import base64

import pytest

from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.apimart.video_payload import build_create_task_body
from app.core.integrations.video_capabilities import (
    audio_input_supported,
    register_video_model_capability,
    validate_video_options,
)
from app.models.studio import FileItem, ShotDetail
from app.services.studio import video_audio_input
from app.services.studio.video_audio_input import attach_shot_audio_to_video_input
from tests.llm_orchestration_fixtures import build_session

SHOT = "shot-audio-1"
FILE_ID = "file-audio-1"
WAV_BYTES = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 16


async def _seed(  # type: ignore[no-untyped-def]
    db, *, with_binding: bool = True, storage_key: str = "files/voice.wav"
) -> None:
    # camera_shot / angle / movement 在表里是 NOT NULL，必须给值
    db.add(
        ShotDetail(
            id=SHOT,
            camera_shot="MS",
            angle="EYE_LEVEL",
            movement="STATIC",
            duration=5,
            audio_file_id=FILE_ID if with_binding else None,
            has_bgm=False,
        )
    )
    db.add(FileItem(id=FILE_ID, type="audio", name="韩虹台词", storage_key=storage_key))
    await db.flush()


# ---------------------------------------------------------------------------
# 契约与能力声明
# ---------------------------------------------------------------------------


def test_contract_accepts_audio_fields() -> None:
    item = VideoGenerationInput(
        prompt="x",
        ratio="9:16",
        generate_audio=True,
        audio_urls=["https://cdn.example.com/a.wav"],
        audio_source_file_id=FILE_ID,
    )
    assert item.generate_audio is True
    assert item.audio_urls == ["https://cdn.example.com/a.wav"]
    assert item.audio_source_file_id == FILE_ID


def test_generate_audio_is_rejected_when_capability_says_unsupported() -> None:
    register_video_model_capability(
        provider="apimart",
        model_prefix="no-audio-model",
        capability=__import__(
            "app.core.integrations.video_capabilities", fromlist=["VideoModelCapability"]
        ).VideoModelCapability(supports_generate_audio=False, min_seconds=1),
    )
    with pytest.raises(ValueError) as caught:
        validate_video_options(
            provider="apimart",
            model="no-audio-model",
            input_=VideoGenerationInput(prompt="x", ratio="9:16", generate_audio=True),
        )
    assert "generate_audio is not supported" in str(caught.value)


def test_apimart_seedance_supports_generate_audio_and_reference_audio() -> None:
    """按官方文档：seedance 既支持 generate_audio 开关，也支持 audio_urls 参考音频。"""
    for model in ("seedance-2.0-mini", "seedance-2.0"):
        cap = __import__(
            "app.core.integrations.video_capabilities", fromlist=["resolve_video_capability"]
        ).resolve_video_capability(provider="apimart", model=model)
        assert cap.supports_generate_audio is True
        assert cap.supports_audio_input is True
        assert cap.max_audio_inputs == 3
        assert cap.max_audio_seconds == 15
        assert cap.audio_input_conflicts_with_frame_roles is True
    assert audio_input_supported(provider="apimart", model="seedance-2.0-mini") is True


# ---------------------------------------------------------------------------
# 请求体：generate_audio 会发；上传音频在 APIMart 上不会发
# ---------------------------------------------------------------------------


def test_payload_emits_generate_audio() -> None:
    body = build_create_task_body(
        VideoGenerationInput(prompt="x", ratio="9:16", model="seedance-2.0-mini", generate_audio=True)
    )
    assert body["generate_audio"] is True


def test_payload_emits_audio_urls_and_never_base64() -> None:
    """官方字段是 ``audio_urls``（数组）；base64 与追溯字段都不能发给供应商。"""
    body = build_create_task_body(
        VideoGenerationInput(
            prompt="x",
            ratio="9:16",
            model="seedance-2.0-mini",
            audio_urls=["https://cdn.example.com/a.wav", "https://cdn.example.com/b.wav"],
            audio_base64="data:audio/wav;base64,AAA",
            audio_source_file_id=FILE_ID,
        )
    )
    assert body["audio_urls"] == ["https://cdn.example.com/a.wav", "https://cdn.example.com/b.wav"]
    assert "audio_base64" not in body
    assert "audio_source_file_id" not in body


def test_payload_caps_audio_urls_at_three() -> None:
    body = build_create_task_body(
        VideoGenerationInput(
            prompt="x",
            ratio="9:16",
            model="seedance-2.0-mini",
            audio_urls=[f"https://cdn.example.com/{i}.wav" for i in range(5)],
        )
    )
    assert len(body["audio_urls"]) == 3


# ---------------------------------------------------------------------------
# 接线：把绑定声音解析进生成入参
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_binding_produces_no_noise() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db, with_binding=False)
        payload: dict = {}
        warnings = await attach_shot_audio_to_video_input(
            db, shot_id=SHOT, input_payload=payload, provider="apimart", model="seedance-2.0-mini"
        )
    assert warnings == []
    assert payload == {}
    await engine.dispose()


@pytest.mark.asyncio
async def test_local_relative_url_is_refused_with_actionable_advice() -> None:
    """真实场景：本地存储 + 未配公网基址 → 供应商抓不到，必须给出可执行建议。

    （本项目实测 `/files/files/xxx.mp3` 就是这种形态。）
    """
    db, engine = await build_session()
    async with db:
        await _seed(db)
        row = await db.get(FileItem, FILE_ID)
        assert row is not None
        payload: dict = {}
        warnings = await attach_shot_audio_to_video_input(
            db, shot_id=SHOT, input_payload=payload, provider="apimart", model="seedance-2.0-mini"
        )
    assert payload["audio_source_file_id"] == FILE_ID
    assert "audio_urls" not in payload
    assert any("本地/相对地址" in item for item in warnings)
    assert any("local_storage_base_url" in item for item in warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_public_url_is_submitted_as_audio_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    """有公网地址时，必须作为 ``audio_urls`` 进入入参。"""
    db, engine = await build_session()
    async with db:
        await _seed(db, storage_key="https://cdn.example.com/voice.wav")
        payload: dict = {}
        warnings = await attach_shot_audio_to_video_input(
            db, shot_id=SHOT, input_payload=payload, provider="apimart", model="seedance-2.0-mini"
        )
    assert payload["audio_urls"] == ["https://cdn.example.com/voice.wav"]
    assert any("参考音频" in item for item in warnings)
    await engine.dispose()


async def test_frame_conflict_is_flagged(monkeypatch: pytest.MonkeyPatch) -> None:
    """首尾帧与参考音频互斥：两者同时出现时必须给冲突提示（不静默改写）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db, storage_key="https://cdn.example.com/voice.wav")
        payload = {"first_frame_base64": "AAA", "last_frame_base64": "BBB"}
        warnings = await attach_shot_audio_to_video_input(
            db, shot_id=SHOT, input_payload=payload, provider="apimart", model="seedance-2.0-mini"
        )
    assert payload["audio_urls"] == ["https://cdn.example.com/voice.wav"]
    assert any("首尾帧图片时参考音频不可用" in item for item in warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_provider_without_reference_audio_warns() -> None:
    """供应商不支持参考音频时也要明说（用未注册的模型前缀走默认能力）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db, storage_key="https://cdn.example.com/voice.wav")
        payload: dict = {}
        warnings = await attach_shot_audio_to_video_input(
            db, shot_id=SHOT, input_payload=payload, provider="openai", model="sora-2"
        )
    assert "audio_urls" not in payload
    assert any("不接受参考音频" in item for item in warnings)
    await engine.dispose()


def test_payload_emits_audio_urls_when_capability_allows(monkeypatch: pytest.MonkeyPatch) -> None:
    """能力表声明支持参考音频时，payload 必须带上 ``audio_urls``。

    这条回归盯的是一个真实踩过的坑：`to_audio_data_url` 一开始忘了在 apimart 的 payload
    模块里 import —— 因为当时默认能力是 False，测试没跑到那条分支，真要接支持音频的
    供应商时才会 NameError。现在字段改成官方的 ``audio_urls``（不再拼 data URL），
    但仍保留"能力放开后必须真的发出去"这条断言。
    """
    body = build_create_task_body(
        VideoGenerationInput(
            prompt="x",
            ratio="9:16",
            model="seedance-2.0-mini",
            audio_urls=["https://cdn.example.com/a.wav"],
            audio_source_file_id=FILE_ID,
        )
    )
    assert body["audio_urls"] == ["https://cdn.example.com/a.wav"]
    assert "audio_source_file_id" not in body


def test_audio_and_frames_switch_to_image_urls() -> None:
    """首尾帧与参考音频互斥（实测 400）→ 有音频时首/尾帧必须改走 image_urls。

    实测记录（2026-09-18，零计费）：同时发 first_frame_image + audio_urls，
    APIMart 直接返回 400 Bad Request。官方文档里"参考图 + 参考音频"的组合是
    image_urls + audio_urls（场景 2 / 场景 9）。
    """
    from app.core.contracts.video_generation import VideoGenerationInput
    from app.core.integrations.apimart.video_payload import build_create_task_body

    base = {"prompt": "x", "ratio": "9:16", "model": "seedance-2.0-mini"}
    audio = ["https://cdn.example.com/a.mp3"]
    first = "https://cdn.example.com/first.png"
    last = "https://cdn.example.com/last.png"

    # 无音频：保持原来的专属字段（公网地址原样透传）
    no_audio = build_create_task_body(VideoGenerationInput(**base, first_frame_base64=first))
    assert no_audio["first_frame_image"] == first
    assert "image_urls" not in no_audio

    # 有音频：首帧改走 image_urls，且 audio_urls 一起发出
    with_audio = build_create_task_body(
        VideoGenerationInput(**base, first_frame_base64=first, audio_urls=audio)
    )
    assert "first_frame_image" not in with_audio
    assert with_audio["image_urls"] == [first]
    assert with_audio["audio_urls"] == audio

    # 首尾帧 + 音频：两张都进 image_urls
    both = build_create_task_body(
        VideoGenerationInput(**base, first_frame_base64=first, last_frame_base64=last, audio_urls=audio)
    )
    assert [k for k in both if "frame_image" in k] == []
    assert both["image_urls"] == [first, last]


def test_apimart_rejects_data_url_images_with_actionable_message() -> None:
    """实测：APIMart 图片入参只接受公网地址，base64 data URL 会被直接 400。

    真正的报错原文（2026-09-18 探针）：
    ``Invalid format for first_frame_image. Only http/https URLs or asset:// private
    asset URLs are supported.``
    这里要求在**本地就拒绝**，并给出可执行建议，而不是把注定失败的请求发出去。
    """
    from app.core.contracts.video_generation import VideoGenerationInput
    from app.core.integrations.apimart.video_payload import build_create_task_body

    base = {"prompt": "x", "ratio": "9:16", "model": "seedance-2.0-mini"}
    with pytest.raises(ValueError) as caught:
        build_create_task_body(VideoGenerationInput(**base, first_frame_base64="AAA"))
    assert "只接受 http" in str(caught.value)
    assert "files/external" in str(caught.value)

    # 公网地址则原样透传（不转 base64）
    url = "https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/a.png"
    body = build_create_task_body(VideoGenerationInput(**base, first_frame_base64=url))
    assert body["first_frame_image"] == url
