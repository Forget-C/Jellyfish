"""Bounded private media access for canvas observations."""
import asyncio
import base64
import json
from dataclasses import dataclass
from decimal import Decimal
from io import BytesIO
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory, TemporaryFile

from botocore.exceptions import BotoCoreError, ClientError
from PIL import Image
from sqlalchemy import select

from app.core import storage
from app.models.studio import FileItem, FileUsage
from app.services.directing.media import extract_boundary_frame, probe_duration


_IMAGE_PREFIX = {'image/png': b'\x89PNG\r\n\x1a\n', 'image/jpeg': b'\xff\xd8\xff', 'image/webp': b'RIFF'}
_MAX_IMAGE_BYTES = 7 * 1024 * 1024
_MAX_VIDEO_BYTES = 32 * 1024 * 1024
_MAX_VIDEO_DATA_BYTES = 7 * 1024 * 1024
_VIDEO_MIME = frozenset({'video/mp4', 'video/quicktime', 'video/webm'})


async def owned_check_files(db, project_id, file_ids, *, lock=False) -> dict[str, FileItem]:
    """Resolve immutable file keys from current project usages, ignoring withdrawn files."""
    if not file_ids:
        return {}
    owned = select(FileUsage.id).where(FileUsage.file_id == FileItem.id, FileUsage.project_id == project_id).exists()
    query = select(FileItem).where(FileItem.id.in_(file_ids), owned, FileItem.deleted_at.is_(None),
                                   FileItem.delete_requested_at.is_(None)).order_by(FileItem.id)
    if lock:
        query = query.with_for_update()
    return {row.id: row for row in await db.scalars(query)}


async def _load_check_content(sessions, project_id, file_id, modality, mime_types, max_bytes):
    """Authorize and bound one stored object before reading its bytes outside the DB session."""
    async with sessions() as db:
        file = (await owned_check_files(db, project_id, {file_id})).get(file_id)
        if file is None or file.type != modality:
            return None
        key = file.storage_key
    return await _load_private_content(key, mime_types, max_bytes)


async def _load_private_content(key, mime_types, max_bytes):
    """Read bytes by an already authorized storage key with fixed media bounds."""
    try:
        info = await storage.get_file_info(key=key)
        mime = info.content_type
        if not info.size or info.size > max_bytes or mime not in mime_types:
            return None
        content = await storage.download_file(key=key)
    except (BotoCoreError, ClientError, OSError, RuntimeError, KeyError):
        return None
    return (mime, content) if len(content) == info.size else None


def _image_url(mime, content):
    if len(content) > _MAX_IMAGE_BYTES or not content.startswith(_IMAGE_PREFIX[mime]):
        return None
    if mime == 'image/webp' and content[8:12] != b'WEBP':
        return None
    return f'data:{mime};base64,{base64.b64encode(content).decode("ascii")}'


async def load_check_image(sessions, project_id: str, file_id: str) -> str | None:
    """Return a private data URL for one authorized image."""
    media = await _load_check_content(sessions, project_id, file_id, 'image', _IMAGE_PREFIX, _MAX_IMAGE_BYTES)
    return _image_url(*media) if media else None


async def load_private_image(key: str) -> str | None:
    """Fetch a bounded image from an authorized file record."""
    media = await _load_private_content(key, _IMAGE_PREFIX, _MAX_IMAGE_BYTES)
    return await asyncio.to_thread(_verified_image_url, *media) if media else None


def _verified_image_url(mime: str, content: bytes) -> str | None:
    try:
        with Image.open(BytesIO(content), formats=[mime.split('/')[1].upper()]) as image:
            image.verify()
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        return None
    return _image_url(mime, content)


async def load_check_video(sessions, project_id: str, file_id: str) -> tuple[str, bytes] | None:
    """Return one bounded owned video for an observation, never a public URL."""
    return await _load_check_content(sessions, project_id, file_id, 'video', _VIDEO_MIME, _MAX_VIDEO_BYTES)


def _video_frame(content, edge):
    with TemporaryFile() as handle:
        handle.write(content)
        duration = probe_duration(handle)
    if not 0 < duration <= 120_000:
        raise ValueError('视频不在静帧检查的可读时长内')
    return extract_boundary_frame(content, 0, duration, edge)


async def load_check_video_frame(sessions, project_id: str, file_id: str, edge: str) -> tuple[str, int] | None:
    """Extract one decoded static frame and keep its measured timestamp."""
    media = await load_check_video(sessions, project_id, file_id)
    return await _decode_video_frame(media[1], edge) if media else None


async def load_private_video_frame(key: str, edge: str) -> tuple[str, int] | None:
    """Decode one static frame from an authorized stored video."""
    media = await _load_private_content(key, _VIDEO_MIME, _MAX_VIDEO_BYTES)
    return await _decode_video_frame(media[1], edge) if media else None


async def _decode_video_frame(content: bytes, edge: str) -> tuple[str, int] | None:
    try:
        image, at_ms = await asyncio.to_thread(_video_frame, content, edge)
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        return None
    url = _image_url('image/png', image)
    return (url, at_ms) if url else None


@dataclass(frozen=True)
class CheckVideoSequence:
    """A private video and the source intervals retained in its payload."""
    data_url: str
    start_ms: int
    end_ms: int
    audio_start_ms: int | None = None
    audio_end_ms: int | None = None


def _packet_timing(path, stream='V:0'):
    """Read packet presentation timestamps and durations for one stream."""
    result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'pipe,file', '-f', 'mov',
        '-select_streams', stream, '-show_entries', 'packet=pts_time,duration_time', '-of', 'json', str(path)],
        capture_output=True, timeout=30, check=True)
    return sorted((round(Decimal(packet['pts_time']) * 1000), round(Decimal(packet['duration_time']) * 1000))
                  for packet in json.loads(result.stdout).get('packets', []))


def _aligned_audio(path, start_ms, end_ms):
    """Return the first audio stream only if it continuously overlaps the picture."""
    packets = _packet_timing(path, 'a:0')
    if not packets or any(duration <= 0 for _, duration in packets):
        return [], None, None
    audio_start = max(start_ms, packets[0][0])
    audio_end = min(end_ms, max(pts + duration for pts, duration in packets))
    if audio_end <= audio_start or any(
        pts + duration + 2 < next_pts for (pts, duration), (next_pts, _) in zip(packets, packets[1:])
    ):
        return [], None, None
    return packets, audio_start, audio_end


def _video_sequence(content, *, include_audio=False):
    """Remux the clip and verify that retained tracks preserve their relative timing."""
    with TemporaryDirectory() as directory:
        source = Path(directory) / 'source'
        output = Path(directory) / 'visual.mp4'
        source.write_bytes(content)
        original = _packet_timing(source)
        if len(original) < 2 or original[0][0] == original[-1][0] or any(duration <= 0 for _, duration in original):
            return None
        start_ms = original[0][0]
        end_ms = max(pts + duration for pts, duration in original)
        if start_ms < 0 or not 2_000 <= end_ms - start_ms <= 40_000:
            return None
        audio, audio_start, audio_end = _aligned_audio(source, start_ms, end_ms) if include_audio else ([], None, None)
        offset = str(Decimal(-start_ms) / 1000)
        audio_options = ['-map', '0:a:0', '-c:a', 'copy'] if audio else ['-an']
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-protocol_whitelist', 'pipe,file', '-f', 'mov',
            '-itsoffset', offset, '-i', str(source), '-copyts', '-avoid_negative_ts', 'disabled', '-map', '0:V:0',
            *audio_options, '-sn', '-dn', '-c:v', 'copy', '-map_metadata', '-1', '-map_chapters', '-1',
            '-movflags', '+faststart', str(output)], capture_output=True, timeout=30, check=True)
        if not 0 < output.stat().st_size <= _MAX_VIDEO_DATA_BYTES:
            return None
        mapped = _packet_timing(output)
        if not mapped or mapped[0][0] != 0 or mapped != [(pts - start_ms, duration) for pts, duration in original]:
            return None
        if audio and _packet_timing(output, 'a:0') != [(pts - start_ms, duration) for pts, duration in audio]:
            return None
        encoded = base64.b64encode(output.read_bytes()).decode('ascii')
        return CheckVideoSequence(f'data:video/mp4;base64,{encoded}', start_ms, end_ms, audio_start, audio_end)


async def load_check_video_sequence(sessions, project_id: str, file_id: str) -> CheckVideoSequence | None:
    """Load and validate one owned video; no fallback to sparse images or inferred timing."""
    media = await load_check_video(sessions, project_id, file_id)
    return await _decode_video_sequence(media, include_audio=False)


async def load_private_video_sequence(key: str, *, include_audio: bool) -> CheckVideoSequence | None:
    """Read a previously authorized file and retain audio only when its timing can be verified."""
    media = await _load_private_content(key, _VIDEO_MIME, _MAX_VIDEO_BYTES)
    sequence = await _decode_video_sequence(media, include_audio=include_audio)
    if sequence is None and include_audio:
        return await _decode_video_sequence(media, include_audio=False)
    return sequence


async def _decode_video_sequence(media, *, include_audio):
    if media is None or media[0] not in ('video/mp4', 'video/quicktime') or media[1][4:8] != b'ftyp':
        return None
    try:
        return await asyncio.to_thread(_video_sequence, media[1], include_audio=include_audio)
    except (OSError, ValueError, TypeError, KeyError, ArithmeticError, subprocess.SubprocessError):
        return None
