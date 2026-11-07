"""Bounded private image access and capability for canvas observations."""
import asyncio
import base64
import subprocess
from tempfile import TemporaryFile

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select

from app.core import storage
from app.core.contracts.generation import FrozenGenerationConfig
from app.models.studio import FileItem, FileUsage
from app.services.directing.media import extract_boundary_frame, probe_duration


_IMAGE_MODELS = frozenset({'qwen3-vl-plus', 'qwen3-vl-flash'})
_IMAGE_PREFIX = {'image/png': b'\x89PNG\r\n\x1a\n', 'image/jpeg': b'\xff\xd8\xff', 'image/webp': b'RIFF'}
_MAX_IMAGE_BYTES = 7 * 1024 * 1024
_MAX_VIDEO_BYTES = 32 * 1024 * 1024
_VIDEO_MIME = frozenset({'video/mp4', 'video/quicktime', 'video/webm'})


def supports_check_image(model: FrozenGenerationConfig | None) -> bool:
    """Only the explicit Bailian Chat Completions image routes are connected."""
    return bool(model and model.provider_key == 'aliyun_bailian' and model.model_name in _IMAGE_MODELS)


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
    if media is None:
        return None
    try:
        image, at_ms = await asyncio.to_thread(_video_frame, media[1], edge)
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        return None
    url = _image_url('image/png', image)
    return (url, at_ms) if url else None
