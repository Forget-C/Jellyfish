from __future__ import annotations

from typing import Any, Literal

from fastapi import HTTPException, status
from sqlalchemy import and_, case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter, Project, Shot
from app.services.common import entity_not_found, relation_mismatch


AssetField = Literal["actor_id", "scene_id", "prop_id", "costume_id", "product_id"]


async def _ensure_project_exists(db: AsyncSession, project_id: str) -> None:
    if await db.get(Project, project_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=entity_not_found("Project"))


async def _ensure_chapter_optional(db: AsyncSession, *, project_id: str, chapter_id: str | None) -> None:
    if chapter_id is None:
        return
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=entity_not_found("Chapter"))
    if chapter.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=relation_mismatch("chapter_id", "project_id"))


async def _ensure_shot_optional(db: AsyncSession, *, project_id: str, chapter_id: str | None, shot_id: str | None) -> None:
    if shot_id is None:
        return
    shot = await db.get(Shot, shot_id)
    if shot is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=entity_not_found("Shot"))
    if chapter_id is not None and shot.chapter_id != chapter_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=relation_mismatch("shot_id", "chapter_id"))
    chapter = await db.get(Chapter, shot.chapter_id)
    if chapter is None or chapter.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=relation_mismatch("shot_id", "project_id"))


async def upsert_project_link(
    db: AsyncSession,
    *,
    model: type,
    asset_field: AssetField,
    asset_id: str,
    project_id: str,
    chapter_id: str | None,
    shot_id: str | None,
) -> Any:  # noqa: ANN401
    """优先补全已有记录（chapter_id/shot_id），否则新建。

    只会做 null -> value 的补全，不会覆盖已有非空字段。
    """

    await _ensure_project_exists(db, project_id)
    await _ensure_chapter_optional(db, project_id=project_id, chapter_id=chapter_id)
    await _ensure_shot_optional(db, project_id=project_id, chapter_id=chapter_id, shot_id=shot_id)

    asset_col = getattr(model, asset_field)

    # 1) exact match: (asset_id, project_id, chapter_id, shot_id)
    stmt = select(model).where(
        asset_col == asset_id,
        model.project_id == project_id,
        model.chapter_id.is_(None) if chapter_id is None else model.chapter_id == chapter_id,
        model.shot_id.is_(None) if shot_id is None else model.shot_id == shot_id,
    )
    row = (await db.execute(stmt)).scalars().first()
    if row is not None:
        return row

    # 2) fill preferred: same (asset_id, project_id) with empty fields
    candidates = select(model).where(asset_col == asset_id, model.project_id == project_id)

    # Only consider records that can be improved by this request
    fill_filters = []
    if chapter_id is not None:
        fill_filters.append(model.chapter_id.is_(None))
    if shot_id is not None:
        fill_filters.append(model.shot_id.is_(None))
    if fill_filters:
        candidates = candidates.where(and_(*fill_filters))

    # Prefer record with more empty fields first (chapter NULL, shot NULL)
    candidates = candidates.order_by(
        case((model.chapter_id.is_(None), 0), else_=1),
        case((model.shot_id.is_(None), 0), else_=1),
        model.id.asc(),
    )

    candidate = (await db.execute(candidates)).scalars().first()
    if candidate is not None:
        changed = False
        if chapter_id is not None and getattr(candidate, "chapter_id") is None:
            candidate.chapter_id = chapter_id
            changed = True
        if shot_id is not None and getattr(candidate, "shot_id") is None:
            candidate.shot_id = shot_id
            changed = True
        if changed:
            await db.flush()
            await db.refresh(candidate)
        return candidate

    # 3) create new
    obj = model(
        project_id=project_id,
        chapter_id=chapter_id,
        shot_id=shot_id,
        **{asset_field: asset_id},
    )
    db.add(obj)
    await db.flush()
    await db.refresh(obj)
    return obj
