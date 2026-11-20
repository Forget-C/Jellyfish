"""准备项目专属图片，并为不再使用的封面登记清理。"""
from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4

from anyio import to_thread
from botocore.exceptions import ClientError
from fastapi import HTTPException, UploadFile
from PIL import Image
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.models.studio import FileItem
from app.services.studio.files import require_available_file

MAX_COVER_BYTES = 20 * 1024 * 1024
MAX_COVER_PIXELS = 40_000_000
COVER_FORMATS = {
    "JPEG": ("jpg", "image/jpeg"),
    "PNG": ("png", "image/png"),
    "GIF": ("gif", "image/gif"),
    "WEBP": ("webp", "image/webp"),
}


def _image_format(data: bytes) -> tuple[str, str]:
    """限制封面解码开销并确认浏览器能读取该格式。"""
    try:
        with Image.open(BytesIO(data), formats=tuple(COVER_FORMATS)) as image:
            if image.width * image.height > MAX_COVER_PIXELS:
                raise HTTPException(422, "封面图片不能超过 4000 万像素")
            image_format = COVER_FORMATS[image.format]
            image.verify()
        with Image.open(BytesIO(data), formats=tuple(COVER_FORMATS)) as image:
            image.load()
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, "请选择可读取的 JPG、PNG、WebP 或 GIF 图片") from exc
    return image_format


async def require_cover_source(db: AsyncSession, file_id: str, *, lock: bool = True) -> FileItem:
    """失效源图在保存时提示重新选择。"""
    try:
        return await require_available_file(db, file_id=file_id, expected_type="image", lock=lock)
    except HTTPException as exc:
        if exc.status_code in (404, 410):
            raise HTTPException(exc.status_code, "源图片已不可用，请重新选择封面") from exc
        raise


async def prepare_cover(
    db: AsyncSession, source_id: str | None, file: UploadFile | None,
) -> FileItem | None:
    """在获取写锁前准备字节。事务失败时，文件清理 Worker 可回收未登记对象。"""
    if file is not None:
        name = file.filename or "项目封面"
        data = await file.read(MAX_COVER_BYTES + 1)
    elif source_id is not None:
        source = await require_cover_source(db, source_id, lock=False)
        name = source.name
        try:
            data = await storage.download_file(key=source.storage_key, max_bytes=MAX_COVER_BYTES + 1)
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey"):
                raise HTTPException(410, "源图片已不可用，请重新选择封面") from exc
            raise
    else:
        return None
    if len(data) > MAX_COVER_BYTES:
        raise HTTPException(413, "封面图片不能超过 20 MB")
    suffix, media_type = await to_thread.run_sync(_image_format, data)
    file_id = uuid4().hex
    key = f"files/{file_id}.{suffix}"
    await storage.upload_file(key=key, data=data, content_type=media_type)
    return FileItem(id=file_id, name=name[:255], type="image", content_type=media_type,
                    size_bytes=len(data), storage_key=key, is_project_cover=True)


async def retire_cover(db: AsyncSession, file_id: str | None) -> None:
    """与项目修改一起登记删除，由文件清理 Worker 回收对象。"""
    if file_id:
        await db.execute(update(FileItem).where(
            FileItem.id == file_id, FileItem.is_project_cover.is_(True),
            FileItem.delete_requested_at.is_(None),
        ).values(delete_requested_at=datetime.now(UTC).replace(tzinfo=None)))
