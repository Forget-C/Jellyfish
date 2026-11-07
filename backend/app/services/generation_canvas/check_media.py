"""Bounded private image access and capability for canvas observations."""
import base64

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select

from app.core import storage
from app.core.contracts.generation import FrozenGenerationConfig
from app.models.studio import FileItem, FileUsage


_IMAGE_MODELS = frozenset({'qwen3-vl-plus', 'qwen3-vl-flash'})
_IMAGE_PREFIX = {'image/png': b'\x89PNG\r\n\x1a\n', 'image/jpeg': b'\xff\xd8\xff', 'image/webp': b'RIFF'}
_MAX_IMAGE_BYTES = 7 * 1024 * 1024


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


async def load_check_image(sessions, project_id: str, file_id: str) -> str | None:
    """Load one small owned image outside the DB session, returning a private data URL."""
    async with sessions() as db:
        file = (await owned_check_files(db, project_id, {file_id})).get(file_id)
        if file is None or file.type != 'image':
            return None
        key = file.storage_key
    try:
        info = await storage.get_file_info(key=key)
        mime = info.content_type
        if not info.size or info.size > _MAX_IMAGE_BYTES or mime not in _IMAGE_PREFIX:
            return None
        content = await storage.download_file(key=key)
    except (BotoCoreError, ClientError, OSError, RuntimeError, KeyError):
        return None
    if len(content) != info.size or not content.startswith(_IMAGE_PREFIX[mime]):
        return None
    if mime == 'image/webp' and content[8:12] != b'WEBP':
        return None
    return f'data:{mime};base64,{base64.b64encode(content).decode("ascii")}'
