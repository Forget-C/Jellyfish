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


def test_extract_frame_uses_real_video_position(tmp_path):
    """从实际视频不同时间提取不同画面，越过末尾不能伪造图片。"""
    from app.services.directing.media import extract_frame
    if not shutil.which('ffmpeg'):
        pytest.skip('ffmpeg required')
    path = tmp_path / 'frames.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=2',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(path)], check=True, timeout=30)
    content = path.read_bytes()
    first, second = extract_frame(content, 0), extract_frame(content, 1000)
    assert first.startswith(b'\x89PNG') and first != second
    with pytest.raises(ValueError, match='没有可提取'):
        extract_frame(content, 3000)


@pytest.mark.asyncio
async def test_take_frame_source_and_project_boundary(tmp_path, monkeypatch):
    """提帧持久保存 Take/时间来源，越界和其他项目请求在下载前被拒绝。"""
    from sqlalchemy import select
    from app.models.studio import FileUsage
    from app.services.directing.production import ProductionService
    from tests.directing.test_store import database, setup_story, output

    download = AsyncMock(return_value=b'test-video')
    monkeypatch.setattr(files.storage, 'download_file', download)
    monkeypatch.setattr(files.storage, 'upload_file', AsyncMock())
    monkeypatch.setattr('app.services.directing.media.extract_frame', lambda content, at_ms: b'\x89PNG\r\n\x1a\nimage')
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, sequence_id, _, _, prompts = await setup_story(db)
            await output(db, prompts[0])
            take = await store.register_take(prompt_revision_id=prompts[0], task_id='task1', output_ordinal=0)
            service = ProductionService(db, 'p1')
            with pytest.raises(ValueError):
                await service.extract_take_frame(sequence_id, take.id, 9000)
            with pytest.raises(ValueError):
                await ProductionService(db, 'p2').extract_take_frame(sequence_id, take.id, 1000)
            download.assert_not_called()
            result = await service.extract_take_frame(sequence_id, take.id, 1000)
            assert result.source.file_id == 'video1'
            assert result.source.media_range.source_in_ms == 1000
            assert result.source.reference == take.id
            usage = await db.scalar(select(FileUsage).where(FileUsage.file_id == result.file_id))
            assert usage.project_id == 'p1' and usage.source_ref == f'frame:{take.id}:1000'


@pytest.mark.parametrize('failure,message', [
    (subprocess.TimeoutExpired('ffmpeg', 30), '提取画面超时'),
    (subprocess.CalledProcessError(1, 'ffmpeg'), '无法解码'),
])
def test_frame_failure_is_actionable(monkeypatch, failure, message):
    """提帧失败转成可显示的业务错误，不向页面返回无说明的 500。"""
    from app.services.directing.media import extract_frame

    def fail(*args, **kwargs):
        """模拟本地媒体处理失败，不依赖损坏文件的特定解码器行为。"""
        raise failure

    monkeypatch.setattr(subprocess, 'run', fail)
    with pytest.raises(ValueError, match=message):
        extract_frame(b'broken-video', 0)


def test_adopted_end_frame_stays_inside_actual_interval(tmp_path):
    """区间末端不在帧时间上时取最后一帧，视频结尾也不向区间外取帧。"""
    import subprocess
    from app.services.directing.media import extract_boundary_frame

    path = tmp_path / 'boundary.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
        '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', str(path)], check=True)
    content = path.read_bytes()
    first, first_ms = extract_boundary_frame(content, 101, 1099, 'start')
    last, last_ms = extract_boundary_frame(content, 101, 1099, 'end')
    ending, ending_ms = extract_boundary_frame(content, 101, 6000, 'end')
    assert first.startswith(b'\x89PNG') and last.startswith(b'\x89PNG') and ending.startswith(b'\x89PNG')
    assert (first_ms, last_ms, ending_ms) == (200, 1000, 5900)
    with pytest.raises(ValueError, match='没有可提取'):
        extract_boundary_frame(content, 101, 199, 'end')


def test_thumbnail_uses_real_frame_with_bounded_dimensions(tmp_path):
    """网格预览从真实视频解码，最长边限制480。"""
    import struct
    from app.services.directing.media import extract_frame

    path = tmp_path / 'thumbnail.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=1',
        '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path)], check=True, timeout=30)
    frame = extract_frame(path.read_bytes(), 0, thumbnail=True)
    assert frame.startswith(b'\x89PNG')
    assert struct.unpack('>II', frame[16:24]) == (480, 270)


@pytest.mark.asyncio
async def test_thumbnail_cache_reuses_bytes_without_creating_business_records(tmp_path, monkeypatch):
    """重复读取复用缓存；其他项目在存储访问前拒绝，不新增业务记录。"""
    from sqlalchemy import func, select
    from botocore.exceptions import ClientError
    from app.models.studio import FileItem, FileUsage
    from app.models.directing import Take
    from app.models.task import Task
    from app.services.directing.production import ProductionService
    from tests.directing.test_store import database, setup_story, output

    cached, reads, decoded = {}, [], []
    async def download(*, key):
        reads.append(key)
        if key.startswith('previews/') and key not in cached:
            raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'GetObject')
        return cached.get(key, b'video')
    async def upload(*, key, data, content_type):
        assert content_type == 'image/png'
        cached[key] = data
    def frame(content, at_ms, *, thumbnail=False):
        assert content == b'video' and at_ms == 0 and thumbnail
        decoded.append(content)
        return b'\x89PNG\r\n\x1a\npreview'
    monkeypatch.setattr(files.storage, 'download_file', download)
    monkeypatch.setattr(files.storage, 'upload_file', upload)
    monkeypatch.setattr('app.services.directing.media.extract_frame', frame)
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, sequence_id, _, _, prompts = await setup_story(db)
            await output(db, prompts[0])
            take = await store.register_take(prompt_revision_id=prompts[0], task_id='task1', output_ordinal=0)
            models = [FileItem, FileUsage, Take, Task]
            before = [await db.scalar(select(func.count()).select_from(model)) for model in models]
            with pytest.raises(ValueError):
                await ProductionService(db, 'p2').take_thumbnail(sequence_id, take.id)
            assert not reads
            service = ProductionService(db, 'p1')
            first = await service.take_thumbnail(sequence_id, take.id)
            second = await service.take_thumbnail(sequence_id, take.id)
            assert first == second and len(decoded) == 1
            cached.clear()
            assert await service.take_thumbnail(sequence_id, take.id) == first
            assert len(decoded) == 2
            assert [await db.scalar(select(func.count()).select_from(model)) for model in models] == before
            assert (await db.get(FileItem, 'video1')).thumbnail_key in cached
            assert (await store.read_take(take.id)).annotation.review_status == 'unreviewed'
