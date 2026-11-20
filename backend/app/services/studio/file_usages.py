"""文件在项目中的使用位置：写入与按项目/章节标题分页查询。"""

from __future__ import annotations

from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import normalize_q
from app.models.studio import (
    Chapter,
    FileItem,
    FileUsage,
    Actor,
    Costume,
    Prop,
    Scene,
)
from app.models.types import FileUsageKind


async def upsert_file_usage(
    session: AsyncSession,
    *,
    file_id: str,
    project_id: str | None,
    chapter_id: str | None,

    usage_kind: FileUsageKind | str,
    source_ref: str | None = None,
) -> FileUsage:
    """按 (file_id, project_id, usage_kind, source_ref) 幂等写入或更新行列。"""
    from app.services.studio.files import require_available_file

    await require_available_file(session, file_id=file_id)
    ref = (source_ref or "")[:128]
    kind_str = usage_kind.value if isinstance(usage_kind, FileUsageKind) else str(usage_kind)

    stmt = (
        select(FileUsage)
        .where(
            FileUsage.file_id == file_id,
            FileUsage.project_id == project_id,
            FileUsage.usage_kind == kind_str,
            FileUsage.source_ref == ref,
        )
        .limit(1)
    )
    row = (await session.execute(stmt)).scalars().first()
    if row is not None:
        row.chapter_id = chapter_id
        await session.flush()
        return row

    fu = FileUsage(
        file_id=file_id,
        project_id=project_id,
        chapter_id=chapter_id,

        usage_kind=kind_str,
        source_ref=ref,
    )
    session.add(fu)
    await session.flush()
    await session.refresh(fu)
    return fu


async def delete_usages_by_file_id(session: AsyncSession, file_id: str) -> None:
    """删除某文件的全部 usage（若未使用 ON DELETE CASCADE 时备用）。"""
    await session.execute(delete(FileUsage).where(FileUsage.file_id == file_id))
    await session.flush()


async def sync_usage_from_character(
    session: AsyncSession,
    *,
    file_id: str,
    character_id: str,
    usage_kind: FileUsageKind | str,
    source_ref: str | None = None,
) -> FileUsage | None:
    from app.models.studio import Character

    char = await session.get(Character, character_id)
    if char is None:
        return None
    return await upsert_file_usage(
        session,
        file_id=file_id,
        project_id=char.project_id,
        chapter_id=None,

        usage_kind=usage_kind,
        source_ref=source_ref,
    )


def _scope_filters(
    *,
    project_id: str | None,
    chapter_title: str | None,

) -> list:
    """返回与 FileUsage 行组合的 WHERE 条件（不含 project_id 基条件）。"""
    conds: list = []

    ch_title = normalize_q(chapter_title)
    if ch_title:
        chapter_ids = select(Chapter.id).where(Chapter.project_id == project_id, Chapter.title == ch_title)
        conds.append(FileUsage.chapter_id.in_(chapter_ids))

    return conds


async def list_files_by_scope_paginated(
    session: AsyncSession,
    *,
    project_id: str | None,
    chapter_title: str | None = None,

    q: str | None = None,
    order: str | None = None,
    is_desc: bool = False,
    page: int = 1,
    page_size: int = 10,
    allow_order_fields: set[str] | None = None,
    default_order: str = "created_at",
    file_type: str | None = None,
) -> tuple[list[FileItem], int]:
    """按项目及可选章节标题过滤文件（标题多命中时并集），去重后分页。"""
    allow_fields = allow_order_fields or {"name", "created_at", "updated_at"}
    order_col = order if order and order in allow_fields else default_order
    ord_attr = getattr(FileItem, order_col)

    def _apply_scope_filters(stmt: Select) -> Select:
        stmt = stmt.where(FileUsage.project_id == project_id)
        for c in _scope_filters(
            project_id=project_id,
            chapter_title=chapter_title,

        ):
            stmt = stmt.where(c)
        return stmt

    qn = normalize_q(q)

    grouped = (
        select(FileItem.id, func.max(ord_attr).label("_ord_key"))
        .join(FileUsage, FileUsage.file_id == FileItem.id)
        .where(FileItem.delete_requested_at.is_(None), FileItem.deleted_at.is_(None), FileItem.is_project_cover.is_(False))
    )
    grouped = _apply_scope_filters(grouped)
    if file_type is not None:
        grouped = grouped.where(FileItem.type == file_type)
    if qn:
        grouped = grouped.where(FileItem.name.ilike(f"%{qn}%"))
    grouped = grouped.group_by(FileItem.id)
    grouped_sub = grouped.subquery()

    count_stmt = select(func.count()).select_from(grouped_sub)
    total_res = await session.execute(count_stmt)
    total = int(total_res.scalar() or 0)

    ordered_ids_stmt = (
        select(grouped_sub.c.id)
        .select_from(grouped_sub)
        .order_by(
            grouped_sub.c._ord_key.desc() if is_desc else grouped_sub.c._ord_key.asc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    id_res = await session.execute(ordered_ids_stmt)
    ids = [str(x) for x in id_res.scalars().all()]
    if not ids:
        return [], total

    order_map = {fid: i for i, fid in enumerate(ids)}
    res2 = await session.execute(select(FileItem).where(FileItem.id.in_(ids)))
    rows = list(res2.scalars().all())
    rows.sort(key=lambda o: order_map.get(o.id, 10**9))
    return rows, total


async def first_project_id_for_scene(session: AsyncSession, scene_id: str) -> str | None:
    stmt = select(Scene.project_id).where(Scene.id == scene_id)
    return (await session.execute(stmt)).scalars().first()


async def first_project_id_for_prop(session: AsyncSession, prop_id: str) -> str | None:
    stmt = select(Prop.project_id).where(Prop.id == prop_id)
    return (await session.execute(stmt)).scalars().first()


async def first_project_id_for_costume(session: AsyncSession, costume_id: str) -> str | None:
    stmt = select(Costume.project_id).where(Costume.id == costume_id)
    return (await session.execute(stmt)).scalars().first()


async def first_project_id_for_actor(session: AsyncSession, actor_id: str) -> str | None:
    stmt = select(Actor.project_id).where(Actor.id == actor_id)
    return (await session.execute(stmt)).scalars().first()


__all__ = [
    "upsert_file_usage",
    "delete_usages_by_file_id",
    "sync_usage_from_character",
    "list_files_by_scope_paginated",
    "first_project_id_for_scene",
    "first_project_id_for_prop",
    "first_project_id_for_costume",
    "first_project_id_for_actor",
]
