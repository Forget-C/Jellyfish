from __future__ import annotations

import base64
import mimetypes

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.models.studio import AssetViewAngle, FileItem


async def resolve_reference_image_refs_by_file_ids(
    db: AsyncSession,
    *,
    file_ids: list[str],
) -> list[dict[str, str]]:
    """将 file_id 列表解析为图片参考（data url）。顺序与入参一致。"""
    out: list[dict[str, str]] = []
    for fid in file_ids or []:
        file_id = (fid or "").strip()
        if not file_id:
            continue
        file_obj = await db.get(FileItem, file_id)
        if file_obj is None or not file_obj.storage_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"FileItem not found or storage_key empty for file_id={file_id}",
            )
        try:
            content = await storage.download_file(key=file_obj.storage_key)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to download file for file_id={file_id}: {exc}",
            ) from exc
        if not content:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Empty file content for file_id={file_id}",
            )

        content_type: str | None = None
        try:
            info = await storage.get_file_info(key=file_obj.storage_key)
            content_type = (info.content_type or "").strip().lower() or None
        except Exception:  # noqa: BLE001
            content_type = None
        if not content_type:
            guessed_type, _ = mimetypes.guess_type(file_obj.storage_key)
            content_type = (guessed_type or "").strip().lower() or None
        if not content_type or not content_type.startswith("image/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File is not an image for file_id={file_id}",
            )

        image_format = content_type.split("/", 1)[1].split(";", 1)[0].strip().lower() or "png"
        encoded = base64.b64encode(content).decode("ascii")
        out.append({"image_url": f"data:image/{image_format};base64,{encoded}"})
    return out


async def pick_front_ref_file_id(
    db: AsyncSession,
    *,
    image_model: type,
    parent_field_name: str,
    parent_id: str,
    preferred_quality_level: object | None,
) -> str | None:
    """按旧语义挑选 front 参考图的 file_id（不下载文件）。"""
    parent_field = getattr(image_model, parent_field_name)
    stmt = (
        select(image_model)
        .where(
            parent_field == parent_id,
            image_model.view_angle == AssetViewAngle.front,
            image_model.file_id.is_not(None),
        )
        .order_by(image_model.created_at.desc(), image_model.id.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return None

    target = rows[0]
    if preferred_quality_level is not None:
        for row in rows:
            if getattr(row, "quality_level", None) == preferred_quality_level:
                target = row
                break

    fid = getattr(target, "file_id", None)
    return str(fid) if fid else None


async def pick_ordered_ref_file_ids(
    db: AsyncSession,
    *,
    image_model: type,
    parent_field_name: str,
    parent_id: str,
    view_angles: tuple[AssetViewAngle, ...],
) -> list[str]:
    """按旧语义按角度顺序挑选参考图 file_id（不下载文件）。"""
    parent_field = getattr(image_model, parent_field_name)
    stmt = (
        select(image_model)
        .where(parent_field == parent_id, image_model.file_id.is_not(None))
        .order_by(image_model.created_at.desc(), image_model.id.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return []

    best_by_angle: dict[str, object] = {}
    for row in rows:
        angle = getattr(row, "view_angle", None)
        key = angle.value if isinstance(angle, AssetViewAngle) else str(angle)
        if key and key not in best_by_angle:
            best_by_angle[key] = row

    out: list[str] = []
    for angle in view_angles:
        row = best_by_angle.get(angle.value)
        if row is None:
            continue
        fid = getattr(row, "file_id", None)
        if fid:
            out.append(str(fid))
    return out
