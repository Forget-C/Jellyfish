"""文件服务：封装文件上传、下载、列表、详情、更新与删除。"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException, UploadFile
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.core import storage
from app.models.studio import FileItem, FileType
from app.schemas.common import ApiResponse, PaginatedData, paginated_response
from app.schemas.studio import FileDetailRead, FileRead, FileUpdate, FileUsageRead, FileUsageWrite
from app.services import paid_outlet_guard
from app.services.common import create_and_refresh, entity_not_found, flush_and_refresh, get_or_404, patch_model
from app.services.studio.file_usages import upsert_file_usage

FILE_ORDER_FIELDS = {"name", "created_at", "updated_at"}


@dataclass(slots=True)
class UploadFileOutcome:
    """上传接口的结果：文件记录 + **上传后地址的匿名可达性**。

    为什么要把可达性一起返回：对象存储写入成功 ≠ 这个对象匿名可读（真实故障 A：
    本机可读、公网 404 的地址被交给上游 → 上游任务 failed）。把验证结果放进响应，
    调用方当场就知道"这个地址上游能不能取到"，不用等下一次提交才炸。

    边界：验证**只报告、不阻断** —— 文件已经落库了，抛错会把已经成功的上传变成失败。
    """

    file: FileItem
    #: 落库后的对象地址（``storage.public_url_for_key`` 的唯一口径；没配公网基址时为空串）
    url: str = ""
    #: True=匿名公网可达；False=不可达（已告警）；None=未验证（演练模式 / 没有拿到地址）
    url_reachable: bool | None = None
    #: 探活明细：result / http_status / method（= probe_method）/ reason / how_to_fix
    url_probe: dict[str, Any] = field(default_factory=dict)
    #: 给用户看的中文告警（含修法；不阻断上传）
    warnings: list[str] = field(default_factory=list)

    def to_read(self) -> dict[str, Any]:
        """文件字段 + 可达性字段（**只增不删**；不含本机绝对路径，标签用文件名）。"""
        payload = FileRead.model_validate(self.file).model_dump()
        payload.update(
            {
                "url": self.url,
                "url_reachable": self.url_reachable,
                "url_probe": dict(self.url_probe),
                "warnings": list(self.warnings),
            }
        )
        return payload


# 后缀白名单。音频之前完全不在白名单里，导致「声音绑定」（shot_details.audio_file_id
# 要求 files.type=audio）在接口层就不可达：用户上传 .mp3/.wav 只会拿到 400。
IMAGE_EXTENSIONS: frozenset[str] = frozenset({".jpg", ".jpeg", ".png", ".webp", ".gif"})
VIDEO_EXTENSIONS: frozenset[str] = frozenset({".mp4", ".mov", ".mkv", ".avi", ".webm"})
AUDIO_EXTENSIONS: frozenset[str] = frozenset(
    {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma", ".aiff", ".aif"}
)


def _detect_file_type(filename: str) -> FileType:
    _, ext = os.path.splitext(filename.lower())
    if ext in IMAGE_EXTENSIONS:
        return FileType.image
    if ext in VIDEO_EXTENSIONS:
        return FileType.video
    if ext in AUDIO_EXTENSIONS:
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
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".oga": "audio/ogg",
        ".opus": "audio/opus",
        ".wma": "audio/x-ms-wma",
        ".aiff": "audio/aiff",
        ".aif": "audio/aiff",
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
    stmt = select(FileItem)
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
    obj = await get_or_404(db, FileItem, file_id, detail=entity_not_found("File"))
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


async def register_external_file(
    db: AsyncSession,
    *,
    url: str,
    name: str | None = None,
    file_type: str | None = None,
    project_id: str | None = None,
    chapter_id: str | None = None,
    shot_id: str | None = None,
    usage_kind: str | None = None,
    source_ref: str | None = None,
) -> FileItem:
    """把**外部公网 URL** 登记成素材（不下载、不在本地存副本）。

    为什么需要：出图/出视频这类外部服务要求输入文件**公网可达**（例如 APIMart 的
    ``audio_urls`` 只收公网 URL 或 ``asset://``）。而 Jellyfish 现有两条建文件的路都不合适：

    - ``upload_file``：把字节传进本地存储 → 地址是相对的 ``/files/...``，供应商抓不到；
    - ``adopt``（``create_file_from_url_or_b64``）：会**下载**到本地再存一份 → 地址又变回相对路径。

    所以这里只登记 URL 本身：``storage_key`` 与 ``thumbnail`` 都写这个绝对地址，
    ``resolve_file_url`` 对绝对地址是直通的，后续交付/生成请求拿到的就是公网地址。

    边界：只接受 ``http(s)://``；不校验远端是否真的可访问（登记不等于可用），
    需要真实验证时由调用方自己拉一次。
    """
    target = str(url or "").strip()
    if not target.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=400,
            detail="只接受 http(s):// 开头的公网地址；本地或相对地址供应商抓不到，请改用上传接口。",
        )

    resolved_type = str(file_type or "").strip().lower()
    if resolved_type and resolved_type not in {item.value for item in FileType}:
        raise HTTPException(status_code=400, detail=f"不支持的素材类型：{file_type}")
    if not resolved_type:
        path = target.split("?", 1)[0]
        _, ext = os.path.splitext(path.lower())
        try:
            resolved_type = _detect_file_type(f"x{ext}").value
        except HTTPException:  # 未知后缀：按图片兜底（与既有推断口径一致）
            resolved_type = FileType.image.value

    display_name = (name or "").strip() or os.path.basename(target.split("?", 1)[0]) or target
    file_item = await create_and_refresh(
        db,
        FileItem(
            id=str(uuid.uuid4()),
            type=resolved_type,
            name=display_name,
            thumbnail=target,
            tags=["external"],
            storage_key=target,
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
) -> UploadFileOutcome:
    """上传文件到对象存储，并创建 FileItem 记录。

    上传成功后**追加一次**匿名可达性验证（``reference_preflight.verify_uploaded_url_reachable``
    —— 全项目唯一实现）：对象写成功 ≠ 匿名可读，真实故障 A 就是把这个地址交给上游后 404。
    **不可达不阻断上传**（文件已落库），但会如实告警并给出修法。

    **付费出口守卫（oss）**：写对象存储是「对象存储上传」出口，与出图 / 出视频 / 大模型
    走**同一套**闸门（``paid_outlet_guard.require_outlet``）。演练模式（默认）下**一个字节
    都不上传、不写文件记录**，直接结构化 409；本地驱动（``is_local_storage()``）落盘是
    本地存储而不是 OSS 上传，不走这道闸门，单机用法不受影响。
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="上传文件缺少文件名")

    file_type = _detect_file_type(file.filename)

    if not storage.is_local_storage():
        paid_outlet_guard.require_outlet(
            "上传文件到对象存储（会真实写入 OSS 并产生公网可读对象）",
            outlet=paid_outlet_guard.OUTLET_OSS,
        )

    display_name = _build_display_name(file.filename, name)
    content = await file.read()

    key = f"files/{file.filename}"
    info = await storage.upload_file(
        key=key,
        data=content,
        content_type=file.content_type,
        extra_args={"ACL": "public-read"},
    )

    file_item = await create_and_refresh(
        db,
        FileItem(
            id=str(uuid.uuid4()),
            type=file_type,
            name=display_name,
            thumbnail=info.url,
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

    # 上传之后验证一次「这个地址上游匿名取不取得到」。label 用显示名（不是 file_id）。
    # 延迟导入：``image_pipeline`` 包在 import 期会拉 ``services.film``，
    # 而 ``services.studio`` 的包 __init__ 又会 import 本模块 —— 顶层导入会形成循环。
    from app.services.studio.image_pipeline import reference_preflight

    reachability = await reference_preflight.verify_uploaded_url_reachable(
        info.url,
        label=display_name,
    )

    return UploadFileOutcome(
        file=file_item,
        url=info.url,
        url_reachable=reachability.reachable,
        url_probe=dict(reachability.probe),
        warnings=list(reachability.warnings),
    )


async def build_download_response(
    db: AsyncSession,
    *,
    file_id: str,
) -> StreamingResponse | RedirectResponse:
    """根据 file_id 构建下载/播放响应。

    **外链素材**（``storage_key`` 是 http(s) 公网地址，例如用
    ``POST /studio/files/external`` 登记的生成视频）不能走本地存储读取 ——
    按本地路径去找必然 500。这类直接 307 重定向到源地址：浏览器/播放器自己拉，
    也避免了把大文件代理进 Jellyfish。
    """
    file_item = await get_or_404(db, FileItem, file_id, detail=entity_not_found("File"))
    storage_key = str(file_item.storage_key or "").strip()
    if storage_key.startswith(("http://", "https://")):
        return RedirectResponse(url=storage_key, status_code=307)

    content = await storage.download_file(key=storage_key)

    filename = Path(storage_key).name or "download"
    media_type = _resolve_download_media_type(filename)
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
    file_item = await get_or_404(db, FileItem, file_id, detail=entity_not_found("File"))
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
    """删除文件记录与对象存储中的内容；若记录不存在则静默返回。"""
    file_item = await db.get(FileItem, file_id)
    if file_item is None:
        return

    try:
        await storage.delete_file(key=file_item.storage_key)
    except Exception:
        # 存储删除失败不阻塞记录删除，保持当前接口语义。
        pass

    await db.delete(file_item)
    await db.flush()
