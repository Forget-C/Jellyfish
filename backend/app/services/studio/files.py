"""文件服务：封装文件上传、下载、列表、详情、更新与删除。"""

from __future__ import annotations

import os
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from botocore.exceptions import ClientError
from fastapi import HTTPException, UploadFile
from sqlalchemy import delete, exists
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.core import storage
from app.models.studio import FileItem, FileType, Project
from app.models.task import Task, TaskInput, TaskOutput
from app.models.studio import ActorImage, CharacterImage, SceneImage, PropImage, CostumeImage
from app.schemas.common import ApiResponse, PaginatedData, paginated_response
from app.schemas.studio import FileDetailRead, FileRead, FileUpdate, FileUsageRead, FileUsageWrite
from app.services.common import get_or_404, create_and_refresh, entity_not_found, flush_and_refresh, patch_model
from app.services.studio.file_usages import upsert_file_usage
from app.models.studio_file_usages import FileUsage

FILE_ORDER_FIELDS = {"name", "created_at", "updated_at"}


def _detect_file_type(filename: str) -> FileType:
    _, ext = os.path.splitext(filename.lower())
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return FileType.image
    if ext in {".mp4", ".mov", ".mkv", ".avi", ".webm"}:
        return FileType.video
    if ext in {".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".opus"}:
        return FileType.audio
    raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext or '未知后缀'}")


def _build_display_name(filename: str, name: str | None) -> str:
    if name:
        return name
    base, _ = os.path.splitext(filename)
    return base or filename


def _resolve_download_media_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".flac": "audio/flac",
        ".opus": "audio/ogg",
    }
    if ext in media_types:
        return media_types[ext]
    if ext in {".mkv", ".avi", ".webm"}:
        return f"video/{ext.lstrip('.')}"
    return "application/octet-stream"


async def list_files_paginated(
    db: AsyncSession,
    *,
    q: str | None,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
    file_type: FileType | None = None,
) -> ApiResponse[PaginatedData[FileRead]]:
    """分页查询文件。"""
    stmt = select(FileItem).where(
        FileItem.delete_requested_at.is_(None), FileItem.deleted_at.is_(None), FileItem.is_project_cover.is_(False),
    )
    if file_type is not None:
        stmt = stmt.where(FileItem.type == file_type)
    stmt = apply_keyword_filter(stmt, q=q, fields=[FileItem.name])
    stmt = apply_order(
        stmt,
        model=FileItem,
        order=order,
        is_desc=is_desc,
        allow_fields=FILE_ORDER_FIELDS,
        default="created_at",
    )
    items, total = await paginate(db, stmt=stmt.order_by(FileItem.id), page=page, page_size=page_size)
    return paginated_response(
        [FileRead.model_validate(x) for x in items],
        page=page,
        page_size=page_size,
        total=total,
    )


async def get_file_detail(
    db: AsyncSession,
    *,
    file_id: str,
) -> FileDetailRead:
    """获取文件详情。"""
    stmt = select(FileItem).options(selectinload(FileItem.usages)).where(FileItem.id == file_id)
    res = await db.execute(stmt)
    obj = res.scalars().first()
    if obj is None or obj.is_project_cover:
        raise HTTPException(status_code=404, detail=entity_not_found("File"))
    usages = [FileUsageRead.model_validate(u) for u in (obj.usages or [])]
    base = FileRead.model_validate(obj)
    return FileDetailRead(**base.model_dump(), usages=usages)


async def update_file_meta(
    db: AsyncSession,
    *,
    file_id: str,
    body: FileUpdate,
) -> FileItem:
    """更新文件元信息，并按需写入 usage。"""
    obj = await require_available_file(db, file_id=file_id)
    data = body.model_dump(exclude_unset=True)
    usage_payload = data.pop("usage", None)
    patch_model(obj, data)
    if usage_payload is not None:
        u = FileUsageWrite.model_validate(usage_payload)
        await upsert_file_usage(
            db,
            file_id=file_id,
            project_id=u.project_id,
            chapter_id=u.chapter_id,

            usage_kind=u.usage_kind,
            source_ref=u.source_ref,
        )
    return await flush_and_refresh(db, obj)


async def upload_file(
    db: AsyncSession,
    *,
    file: UploadFile,
    name: str | None = None,
    project_id: str | None = None,
    chapter_id: str | None = None,

    usage_kind: str | None = None,
    source_ref: str | None = None,
    file_id: str | None = None,
) -> FileItem:
    """上传文件到对象存储，并创建 FileItem 记录。"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="上传文件缺少文件名")

    if project_id:
        await get_or_404(db, Project, project_id, detail="Project not found")
    file_type = _detect_file_type(file.filename)
    display_name = _build_display_name(file.filename, name)
    file_id = file_id or uuid.uuid4().hex
    key = f"files/{file_id}{Path(file.filename).suffix.lower()}"
    await storage.upload_file(
        key=key,
        data=file.file,
        content_type=file.content_type,
    )

    file_item = await create_and_refresh(
        db,
        FileItem(
            id=file_id,
            type=file_type,
            name=display_name,
            content_type=file.content_type or _resolve_download_media_type(file.filename),
            size_bytes=file.size,
            tags=[],
            storage_key=key,
        ),
    )

    if project_id and usage_kind:
        await upsert_file_usage(
            db,
            file_id=file_item.id,
            project_id=project_id,
            chapter_id=chapter_id,

            usage_kind=usage_kind,
            source_ref=source_ref,
        )

    return file_item


async def build_download_response(
    db: AsyncSession,
    *,
    file_id: str,
    range_header: str | None = None,
) -> StreamingResponse:
    """下载文件并支持浏览器单区间读取，保证视频可跳转到真实入出点。"""
    file_item = await require_available_file(db, file_id=file_id, lock=False, allow_project_cover=True)
    try:
        content = await storage.download_file(key=file_item.storage_key)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"NoSuchKey", "NotFound", "404"}:
            raise HTTPException(status_code=404, detail="File content not found") from error
        raise
    filename = Path(file_item.storage_key).name or "download"
    media_type = file_item.content_type if file_item.content_type != "application/octet-stream" else _resolve_download_media_type(filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}", "Accept-Ranges": "bytes"}
    status_code = 200
    total = len(content)
    if range_header:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
        if match is None or not any(match.groups()) or not total:
            raise HTTPException(status_code=416, detail="Invalid byte range", headers={"Content-Range": f"bytes */{total}"})
        left, right = match.groups()
        start = int(left) if left else max(0, total - int(right))
        end = min(total - 1, int(right)) if left and right else total - 1
        if start >= total or end < start:
            raise HTTPException(status_code=416, detail="Byte range outside file", headers={"Content-Range": f"bytes */{total}"})
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        content = content[start:end + 1]
        status_code = 206
    headers["Content-Length"] = str(len(content))
    return StreamingResponse(iter([content]), status_code=status_code, media_type=media_type, headers=headers)


async def get_storage_info(
    db: AsyncSession,
    *,
    file_id: str,
) -> dict[str, Any]:
    """读取对象存储信息。"""
    file_item = await require_available_file(db, file_id=file_id, lock=False)
    info = await storage.get_file_info(key=file_item.storage_key)
    return {
        "key": info.key,
        "url": info.url,
        "size": info.size,
        "content_type": info.content_type,
        "etag": info.etag,
    }


async def delete_file(
    db: AsyncSession,
    *,
    file_id: str,
) -> None:
    """登记文件删除请求，保留文件行和任务历史，由 Worker 删除对象字节。"""
    file_item = await db.get(FileItem, file_id, with_for_update=True, populate_existing=True)
    if file_item is None or file_item.delete_requested_at is not None:
        return
    if file_item.is_project_cover:
        raise HTTPException(status_code=409, detail="请在项目设置中管理封面")
    await _ensure_file_is_unreferenced(db, file_id=file_item.id, name=file_item.name)
    file_item.delete_requested_at = datetime.now(UTC).replace(tzinfo=None)
    await db.flush()


async def require_available_file(
    db: AsyncSession, *, file_id: str, lock: bool = True, expected_type: str | None = None,
    allow_project_cover: bool = False,
) -> FileItem:
    """新增使用关系前锁定文件，与删除登记串行化，拒绝再次使用已删除内容。"""
    file = await db.get(FileItem, file_id, with_for_update=lock, populate_existing=True)
    if file is None:
        raise HTTPException(status_code=404, detail=entity_not_found("File"))
    if file.delete_requested_at is not None or file.deleted_at is not None:
        raise HTTPException(status_code=410, detail="File deleted")
    if file.is_project_cover and not allow_project_cover:
        raise HTTPException(status_code=404, detail=entity_not_found("File"))
    if expected_type is not None and file.type != expected_type:
        raise HTTPException(status_code=422, detail=f"Expected {expected_type} file")
    return file


async def _ensure_file_is_unreferenced(db: AsyncSession, *, file_id: str, name: str, ignored_usage_ids: tuple[int, ...] = ()) -> None:
    """历史任务引用不阻止删除字节；活动任务与实际业务采用关系必须保护。"""
    from app.services.studio.resource_references import require_no_saved_references

    await require_no_saved_references(db, {"file_id": file_id}, label=f"图片「{name}」")
    for model in (FileUsage, ActorImage, CharacterImage, SceneImage, PropImage, CostumeImage):
        conditions = [model.file_id == file_id]
        if model is FileUsage and ignored_usage_ids:
            conditions.append(FileUsage.id.not_in(ignored_usage_ids))
        if await db.scalar(select(exists().where(*conditions))):
            raise HTTPException(status_code=409, detail="素材仍被业务使用")
    for relation in (TaskInput, TaskOutput):
        active = select(relation.task_id).join(Task, Task.id == relation.task_id).where(
            relation.file_id == file_id, Task.status.in_(["queued", "running"]),
        ).limit(1)
        if await db.scalar(active) is not None:
            raise HTTPException(status_code=409, detail="素材仍被活动任务使用")


async def release_upload_retention(db: AsyncSession, *, file_id: str, project_id: str) -> None:
    """显式释放本项目的画布上传保留；其他真实引用存在时拒绝，文件删除仍需单独请求。"""
    file = await require_available_file(db, file_id=file_id)
    ids = tuple((await db.scalars(select(FileUsage.id).where(
        FileUsage.file_id == file_id, FileUsage.project_id == project_id,
        FileUsage.usage_kind == 'generation_upload'))).all())
    if not ids:
        raise HTTPException(404, 'Upload retention not found')
    await _ensure_file_is_unreferenced(db, file_id=file.id, name=file.name, ignored_usage_ids=ids)
    await db.execute(delete(FileUsage).where(FileUsage.id.in_(ids)))
    await db.flush()
