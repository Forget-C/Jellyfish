"""音频文件类型（声音绑定前置条件）测试。

背景（实测缺口）：``FileType.audio`` 加进模型枚举了，但**接口层三处都没放开**，
声音绑定在 HTTP 上根本走不通：

1. ``app/services/studio/files.py::_detect_file_type`` 不认识音频后缀 → 上传直接 400；
2. ``app/utils/files.py`` 的 ext / content-type 推断把音频一律当图片 → ``type=image``；
3. ``app/schemas/studio/files.py::FileTypeEnum`` 只有 image/video → 序列化音频文件时
   抛 ResponseValidationError（表现为 500）。

本文件把这三条锁住，避免以后又悄悄回退。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.types import FileType
from app.schemas.studio.files import FileRead, FileTypeEnum
from app.services.studio.files import _detect_file_type, _resolve_download_media_type
from app.utils.files import _infer_file_type_from_content_type, _infer_file_type_from_ext


@pytest.mark.parametrize("filename", ["a.mp3", "A.WAV", "voice.m4a", "x.flac", "y.ogg", "z.opus"])
def test_upload_detects_audio_extensions(filename: str) -> None:
    assert _detect_file_type(filename) is FileType.audio


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("a.png", FileType.image),
        ("b.webp", FileType.image),
        ("c.mp4", FileType.video),
        ("d.MOV", FileType.video),
    ],
)
def test_upload_keeps_existing_image_video_behaviour(filename: str, expected: FileType) -> None:
    assert _detect_file_type(filename) is expected


def test_upload_still_rejects_unknown_extension() -> None:
    with pytest.raises(HTTPException) as caught:
        _detect_file_type("payload.exe")
    assert caught.value.status_code == 400


@pytest.mark.parametrize(
    ("ext", "expected"),
    [(".mp3", FileType.audio), (".wav", FileType.audio), (".png", FileType.image), (".mp4", FileType.video)],
)
@pytest.mark.asyncio
async def test_infer_from_ext_knows_audio(ext: str, expected: FileType) -> None:
    assert await _infer_file_type_from_ext(ext) is expected


@pytest.mark.parametrize(
    ("content_type", "expected"),
    [
        ("audio/mpeg", FileType.audio),
        ("audio/wav", FileType.audio),
        ("application/ogg", FileType.audio),
        ("image/png", FileType.image),
        ("video/mp4", FileType.video),
        (None, FileType.image),
    ],
)
@pytest.mark.asyncio
async def test_infer_from_content_type_knows_audio(content_type: str | None, expected: FileType) -> None:
    assert await _infer_file_type_from_content_type(content_type) is expected


def test_response_schema_accepts_audio_type() -> None:
    """音频 FileItem 必须能序列化，否则接口会在返回阶段 500。"""
    read = FileRead(id="f-audio", type="audio", name="周法官台词配音", thumbnail="/files/a.mp3", tags=[])
    assert read.type is FileTypeEnum.audio
    assert FileTypeEnum.audio.value == FileType.audio.value


def test_audio_download_media_types() -> None:
    assert _resolve_download_media_type("a.mp3") == "audio/mpeg"
    assert _resolve_download_media_type("a.wav") == "audio/wav"
    assert _resolve_download_media_type("a.m4a") == "audio/mp4"
    assert _resolve_download_media_type("a.png") == "image/png"


# ---------------------------------------------------------------------------
# 外部公网素材登记（供应商要求公网可达时用；不下载、不存副本）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_external_file_keeps_absolute_url() -> None:
    """音频要作为 APIMart 的 audio_urls 提交，storage_key 必须是公网绝对地址。

    另两条建文件的路都不合适：upload 会变成相对 `/files/...`；adopt 会下载到本地
    再存一份、地址同样变回相对路径。
    """
    from app.services.studio.files import register_external_file
    from tests.llm_orchestration_fixtures import build_session

    url = "https://cdn.example.com/audio/%E4%BD%A0%E4%BB%A5%E4%B8%BA.mp3"
    db, engine = await build_session()
    async with db:
        row = await register_external_file(db, url=url, name="你以为配音")
    assert row.type == "audio"
    assert row.storage_key == url
    assert row.thumbnail == url
    assert row.name == "你以为配音"
    await engine.dispose()


@pytest.mark.asyncio
async def test_register_external_file_rejects_relative_url() -> None:
    from fastapi import HTTPException

    from app.services.studio.files import register_external_file
    from tests.llm_orchestration_fixtures import build_session

    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as caught:
            await register_external_file(db, url="/files/voice.mp3")
    assert caught.value.status_code == 400
    assert "公网地址" in str(caught.value.detail)
    await engine.dispose()


@pytest.mark.asyncio
async def test_register_external_file_infers_type_from_suffix() -> None:
    from app.services.studio.files import register_external_file
    from tests.llm_orchestration_fixtures import build_session

    db, engine = await build_session()
    async with db:
        audio = await register_external_file(db, url="https://cdn.example.com/a.WAV?v=2")
        video = await register_external_file(db, url="https://cdn.example.com/b.mp4")
        image = await register_external_file(db, url="https://cdn.example.com/c.png")
    assert (audio.type, video.type, image.type) == ("audio", "video", "image")
    # 带 query 的 URL 也要正确取后缀
    assert audio.name == "a.WAV"
    await engine.dispose()


@pytest.mark.asyncio
async def test_external_audio_resolves_back_to_public_url_for_generation() -> None:
    """闭环：登记的外链音频必须能被「声音绑定」解析回公网地址（否则生成请求带不上）。"""
    from app.models.studio import FileItem, ShotDetail
    from app.services.studio.bound_asset_files import resolve_shot_audio_file
    from app.services.studio.files import register_external_file
    from tests.llm_orchestration_fixtures import build_session

    url = "https://cdn.example.com/audio/voice.mp3"
    db, engine = await build_session()
    async with db:
        row = await register_external_file(db, url=url, name="配音")
        db.add(
            ShotDetail(
                id="shot-ext-1",
                camera_shot="MS",
                angle="EYE_LEVEL",
                movement="STATIC",
                duration=5,
                audio_file_id=str(row.id),
                has_bgm=False,
            )
        )
        await db.flush()
        resolved = await resolve_shot_audio_file(db, shot_id="shot-ext-1")
    assert resolved is not None
    assert resolved.url == url
    assert resolved.usable is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_external_file_download_redirects_to_source() -> None:
    """外链素材的下载/播放接口必须 307 重定向到源地址。

    真实踩到的坑：用 `files/external` 登记的视频，界面播放地址是
    `/api/v1/studio/files/{id}/download`，而这个接口此前一律走本地存储读取 ——
    外链的 storage_key 是个 URL，按本地路径去找必然 500，界面就播不出来。
    """
    import os

    from app.services.studio.files import build_download_response, register_external_file
    from tests.llm_orchestration_fixtures import build_session

    url = "https://cdn.example.com/video/real.mp4"
    db, engine = await build_session()
    async with db:
        row = await register_external_file(db, url=url, name="外链视频", file_type="video")
        os.environ["JELLYFISH_TEST_SKIP"] = "1"
        resp = await build_download_response(db, file_id=str(row.id))
    assert getattr(resp, "status_code", None) == 307
    assert resp.headers["location"] == url
    await engine.dispose()
