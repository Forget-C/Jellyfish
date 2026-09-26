from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import AssetViewAngle
from app.schemas.studio.shots import ShotLinkedAssetItem


async def resolve_reference_file_ids_and_names_from_linked_items(
    db: AsyncSession,  # noqa: ARG001
    *,
    items: list[ShotLinkedAssetItem],
) -> tuple[list[str], list[str]]:
    """将关联资产条目解析为参考图 file_id 列表（顺序有效）。"""
    file_ids: list[str] = []
    names: list[str] = []
    for item in items or []:
        name = (item.name or "").strip()
        file_id = (item.file_id or "").strip()
        if not file_id:
            continue
        file_ids.append(str(file_id))
        names.append(name or (item.id or ""))
    return file_ids, names


async def resolve_reference_image_refs_by_file_ids(
    db: AsyncSession,
    *,
    file_ids: list[str],
) -> list[dict[str, str]]:
    """将 file_id 列表解析为图片参考（公网地址优先，否则 data url）。顺序与入参一致。

    任何一张解析失败都抛 400（保持既有契约）。需要"坏一张不拖垮整批"的调用方用
    ``resolve_reference_refs_with_warnings``。
    """
    refs, _warnings = await _resolve_refs(db, file_ids=file_ids, strict=True)
    return refs


async def resolve_reference_refs_with_warnings(
    db: AsyncSession,
    *,
    file_ids: list[str],
) -> tuple[list[dict[str, str]], list[str]]:
    """同上，但解析失败的 file_id 只记 warning 并跳过。

    关键帧生成用它：镜头绑定了一堆资产，其中某一条的图片文件坏了不应该让整次生成失败
    （用户至少还能拿到"用剩下的参考图出的图 + 明确警告"）。
    """
    refs, _kept, warnings = await resolve_reference_refs_reporting(db, file_ids=file_ids)
    return refs, warnings


async def resolve_reference_refs_reporting(
    db: AsyncSession,
    *,
    file_ids: list[str],
) -> tuple[list[dict[str, str]], list[str], list[str]]:
    """逐条解析并**分别**报告：``(refs, 真的解析成功的 file_id, warnings)``。

    为什么需要"成功的 file_id"：计划预览必须只承诺**真的送得出去**的参考图。
    以前计划里按"绑定资产数"报数，实际提交时坏图被跳过 —— 计划与实际不一致，
    正是"看不出保存内容有没有被用上"的成因之一。
    """
    return await _resolve_refs(db, file_ids=file_ids, strict=False, report_ids=True)


async def _resolve_refs(
    db: AsyncSession,
    *,
    file_ids: list[str],
    strict: bool,
    report_ids: bool = False,
) -> Any:
    from app.utils.files import file_id_to_image_ref

    out: list[dict[str, str]] = []
    warnings: list[str] = []
    kept: list[str] = []
    for fid in file_ids or []:
        file_id = (fid or "").strip()
        if not file_id:
            continue
        try:
            ref = await file_id_to_image_ref(db, file_id=file_id)
        except HTTPException as exc:
            if strict:
                raise
            warnings.append(f"参考图 file_id={file_id} 无法解析（{exc.detail}），本次已跳过该图。")
            continue
        out.append({"image_url": ref})
        kept.append(file_id)
    if report_ids:
        return out, kept, warnings
    return out, warnings


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
