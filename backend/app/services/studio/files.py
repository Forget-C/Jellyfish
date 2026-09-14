"""文件服务：封装文件上传、下载、列表、详情、更新与删除。"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException, UploadFile
from sqlalchemy import exists
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.core import storage
from app.models.studio import FileItem, FileType
from app.models.task import Task, TaskInput, TaskOutput
from app.models.studio import ActorImage, CharacterImage, SceneImage, PropImage, CostumeImage, ShotFrameImage, Shot
from app.schemas.common import ApiResponse, PaginatedData, paginated_response
from app.schemas.studio import FileDetailRead, FileRead, FileUpdate, FileUsageRead, FileUsageWrite
from app.services.common import create_and_refresh, entity_not_found, flush_and_refresh, get_or_404, patch_model
from app.services.studio.file_usages import upsert_file_usage
from app.models.studio_file_usages import FileUsage

FILE_ORDER_FIELDS = {"name", "created_at", "updated_at"}


def _detect_file_type(filename: str) -> FileType:
    _, ext = os.path.splitext(filename.lower())
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return FileType.image
    if ext in {".mp4", ".mov", ".mkv", ".avi", ".webm"}:
        return FileType.video
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
) -> ApiResponse[PaginatedData[FileRead]]:
    """分页查询文件。"""
    stmt = select(FileItem).where(FileItem.delete_requested_at.is_(None), FileItem.deleted_at.is_(None))
    stmt = apply_keyword_filter(stmt, q=q, fields=[FileItem.name])
    stmt = apply_order(
        stmt,
        model=FileItem,
        order=order,
        is_desc=is_desc,
        allow_fields=FILE_ORDER_FIELDS,
        default="created_at",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)
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
    if obj is None:
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
            shot_id=u.shot_id,
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
    shot_id: str | None = None,
    usage_kind: str | None = None,
    source_ref: str | None = None,
) -> FileItem:
    """上传文件到对象存储，并创建 FileItem 记录。"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="上传文件缺少文件名")

    file_type = _detect_file_type(file.filename)
    display_name = _build_display_name(file.filename, name)
    file_id = uuid.uuid4().hex
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
            shot_id=shot_id,
            usage_kind=usage_kind,
            source_ref=source_ref,
        )

    return file_item


async def build_download_response(
    db: AsyncSession,
    *,
    file_id: str,
) -> StreamingResponse:
    """根据 file_id 构建下载响应。"""
    file_item = await require_available_file(db, file_id=file_id, lock=False)
    content = await storage.download_file(key=file_item.storage_key)

    filename = Path(file_item.storage_key).name or "download"
    media_type = file_item.content_type if file_item.content_type != "application/octet-stream" else _resolve_download_media_type(filename)
    content_disposition = f"attachment; filename*=UTF-8''{quote(filename)}"
    return StreamingResponse(
        iter([content]),
        media_type=media_type,
        headers={"Content-Disposition": content_disposition},
    )


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
    await _ensure_file_is_unreferenced(db, file_id=file_id)
    file_item.delete_requested_at = datetime.now(UTC).replace(tzinfo=None)
    await db.flush()


async def require_available_file(
    db: AsyncSession, *, file_id: str, lock: bool = True, expected_type: str | None = None,
) -> FileItem:
    """新增使用关系前锁定文件，与删除登记串行化，拒绝再次使用已删除内容。"""
    file = await db.get(FileItem, file_id, with_for_update=lock, populate_existing=True)
    if file is None:
        raise HTTPException(status_code=404, detail=entity_not_found("File"))
    if file.delete_requested_at is not None or file.deleted_at is not None:
        raise HTTPException(status_code=410, detail="File deleted")
    if expected_type is not None and file.type != expected_type:
        raise HTTPException(status_code=422, detail=f"Expected {expected_type} file")
    return file


async def _ensure_file_is_unreferenced(db: AsyncSession, *, file_id: str) -> None:
    """历史任务引用不阻止删除字节；活动任务与实际业务采用关系必须保护。"""
    for model in (FileUsage, ActorImage, CharacterImage, SceneImage, PropImage, CostumeImage, ShotFrameImage):
        if await db.scalar(select(exists().where(model.file_id == file_id))):
            raise HTTPException(status_code=409, detail="素材仍被业务使用")
    if await db.scalar(select(exists().where(Shot.generated_video_file_id == file_id))):
        raise HTTPException(status_code=409, detail="素材仍被镜头使用")
    for relation in (TaskInput, TaskOutput):
        active = select(relation.task_id).join(Task, Task.id == relation.task_id).where(
            relation.file_id == file_id, Task.status.in_(["queued", "running"]),
        ).limit(1)
        if await db.scalar(active) is not None:
            raise HTTPException(status_code=409, detail="素材仍被活动任务使用")
