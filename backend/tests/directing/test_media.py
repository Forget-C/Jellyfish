"""真实媒体时长和字节区间播放的基础验证，不替代供应商试拍。"""

import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.services.directing.media import probe_duration
from app.services.studio import files


def test_probe_reads_actual_video_duration(tmp_path):
    """使用本地编码的两秒测试视频，证明时长来自文件内容。"""
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg/ffprobe required")
    path = tmp_path / "duration.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=2",
                    "-c:v", "libx264", "-movflags", "+faststart", str(path)], check=True, timeout=30)
    with path.open("rb") as stream:
        assert probe_duration(stream) == 2000
        assert stream.tell() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("header,status,expected", [(None, 200, b"0123456789"), ("bytes=2-5", 206, b"2345"),
    ("bytes=7-", 206, b"789"), ("bytes=-3", 206, b"789"), ("bytes=0-999", 206, b"0123456789")])
async def test_playback_byte_ranges(monkeypatch, header, status, expected):
    """浏览器首段、尾段及随机跳转收到准确内容与长度。"""
    monkeypatch.setattr(files, "require_available_file", AsyncMock(return_value=SimpleNamespace(storage_key="files/test", content_type="video/mp4")))
    monkeypatch.setattr(files.storage, "download_file", AsyncMock(return_value=b"0123456789"))
    response = await files.build_download_response(None, file_id="test", range_header=header)
    assert response.status_code == status
    assert b"".join([part async for part in response.body_iterator]) == expected
    assert response.headers["content-length"] == str(len(expected))
    assert response.headers["content-type"] == "video/mp4"


@pytest.mark.asyncio
@pytest.mark.parametrize("header", ["bytes=10-", "bytes=-0", "bytes=5-2", "bytes=-", "bytes=0-1,4-5"])
async def test_invalid_playback_ranges(monkeypatch, header):
    """越界、反向、空区间和未支持的多区间请求明确返回 416。"""
    monkeypatch.setattr(files, "require_available_file", AsyncMock(return_value=SimpleNamespace(storage_key="files/test", content_type="video/mp4")))
    monkeypatch.setattr(files.storage, "download_file", AsyncMock(return_value=b"0123456789"))
    with pytest.raises(HTTPException) as error:
        await files.build_download_response(None, file_id="test", range_header=header)
    assert error.value.status_code == 416
