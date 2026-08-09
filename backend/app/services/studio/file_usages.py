"""文件在项目中的使用位置：写入与按项目/章节标题/镜头标题分页查询。"""

from __future__ import annotations

from sqlalchemy import Select, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import normalize_q
from app.models.studio import (
    Chapter,
    FileItem,
    FileUsage,
    ProjectActorLink,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Shot,
)
from app.models.types import FileUsageKind


async def upsert_file_usage(
    session: AsyncSession,
    *,
    file_id: str,
    project_id: str,
    chapter_id: str | None,
    shot_id: str | None,
    usage_kind: FileUsageKind | str,
    source_ref: str | None = None,
) -> FileUsage:
    """按 (file_id, usage_kind, source_ref) 幂等写入或更新行列。"""
    ref = (source_ref or "")[:128]
    kind_str = usage_kind.value if isinstance(usage_kind, FileUsageKind) else str(usage_kind)

    stmt = (
        select(FileUsage)
        .where(
            FileUsage.file_id == file_id,
            FileUsage.usage_kind == kind_str,
            FileUsage.source_ref == ref,
        )
        .limit(1)
    )
    row = (await session.execute(stmt)).scalars().first()
    if row is not None:
        row.project_id = project_id
        row.chapter_id = chapter_id
        row.shot_id = shot_id
        await session.flush()
        return row

    fu = FileUsage(
        file_id=file_id,
        project_id=project_id,
        chapter_id=chapter_id,
        shot_id=shot_id,
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


async def sync_usage_from_shot_context(
    session: AsyncSession,
    *,
    file_id: str,
    shot_id: str,
    usage_kind: FileUsageKind | str,
    source_ref: str | None = None,
) -> FileUsage | None:
    shot = await session.get(Shot, shot_id)
    if shot is None:
        return None
    chapter = await session.get(Chapter, shot.chapter_id)
    if chapter is None:
        return None
    return await upsert_file_usage(
        session,
        file_id=file_id,
        project_id=chapter.project_id,
        chapter_id=chapter.id,
        shot_id=shot_id,
        usage_kind=usage_kind,
        source_ref=source_ref,
    )


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
        shot_id=None,
        usage_kind=usage_kind,
        source_ref=source_ref,
    )


def _scope_filters(
    *,
    project_id: str,
    chapter_title: str | None,
    shot_title: str | None,
    chapter_id: str | None = None,
    usage_kind: str | None = None,
) -> list:
    """返回与 FileUsage 行组合的 WHERE 条件（不含 project_id 基条件）。

    ``chapter_id`` / ``usage_kind`` 为附加的精确过滤：按 ID 定位章节比按标题稳妥
    （标题不唯一），``usage_kind`` 用于直接取出某一类产物（如 subtitle）。
    两者都可选，省略时行为与既有实现完全一致。
    """
    conds: list = []

    if chapter_id:
        conds.append(FileUsage.chapter_id == chapter_id)
    if usage_kind:
        conds.append(FileUsage.usage_kind == usage_kind)

    ch_title = normalize_q(chapter_title)
    sh_title = normalize_q(shot_title)

    ch_ids_matching_title = select(Chapter.id).where(
        Chapter.project_id == project_id,
        Chapter.title == ch_title,
    )

    if ch_title and sh_title:
        shot_ids = select(Shot.id).where(
            Shot.chapter_id.in_(ch_ids_matching_title),
            Shot.title == sh_title,
        )
        conds.append(FileUsage.shot_id.in_(shot_ids))
    elif ch_title and not sh_title:
        conds.append(
            or_(
                FileUsage.chapter_id.in_(ch_ids_matching_title),
                FileUsage.shot_id.in_(
                    select(Shot.id).where(Shot.chapter_id.in_(ch_ids_matching_title))
                ),
            )
        )
    elif sh_title and not ch_title:
        shot_ids = (
            select(Shot.id)
            .join(Chapter, Shot.chapter_id == Chapter.id)
            .where(
                Chapter.project_id == project_id,
                Shot.title == sh_title,
            )
        )
        conds.append(FileUsage.shot_id.in_(shot_ids))

    return conds


async def list_files_by_scope_paginated(
    session: AsyncSession,
    *,
    project_id: str,
    chapter_title: str | None = None,
    shot_title: str | None = None,
    chapter_id: str | None = None,
    usage_kind: str | None = None,
    q: str | None = None,
    order: str | None = None,
    is_desc: bool = False,
    page: int = 1,
    page_size: int = 10,
    allow_order_fields: set[str] | None = None,
    default_order: str = "created_at",
) -> tuple[list[FileItem], int]:
    """按项目及可选章节标题、镜头标题过滤文件（标题多命中时并集），去重后分页。"""
    allow_fields = allow_order_fields or {"name", "created_at", "updated_at"}
    order_col = order if order and order in allow_fields else default_order
    ord_attr = getattr(FileItem, order_col)

    def _apply_scope_filters(stmt: Select) -> Select:
        stmt = stmt.where(FileUsage.project_id == project_id)
        for c in _scope_filters(
            project_id=project_id,
            chapter_title=chapter_title,
            shot_title=shot_title,
            chapter_id=chapter_id,
            usage_kind=usage_kind,
        ):
            stmt = stmt.where(c)
        return stmt

    qn = normalize_q(q)

    grouped = (
        select(FileItem.id, func.max(ord_attr).label("_ord_key"))
        .join(FileUsage, FileUsage.file_id == FileItem.id)
    )
    grouped = _apply_scope_filters(grouped)
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
    stmt = select(ProjectSceneLink.project_id).where(ProjectSceneLink.scene_id == scene_id).limit(1)
    return (await session.execute(stmt)).scalars().first()


async def first_project_id_for_prop(session: AsyncSession, prop_id: str) -> str | None:
    stmt = select(ProjectPropLink.project_id).where(ProjectPropLink.prop_id == prop_id).limit(1)
    return (await session.execute(stmt)).scalars().first()


async def first_project_id_for_costume(session: AsyncSession, costume_id: str) -> str | None:
    stmt = select(ProjectCostumeLink.project_id).where(ProjectCostumeLink.costume_id == costume_id).limit(1)
    return (await session.execute(stmt)).scalars().first()


async def first_project_id_for_actor(session: AsyncSession, actor_id: str) -> str | None:
    stmt = select(ProjectActorLink.project_id).where(ProjectActorLink.actor_id == actor_id).limit(1)
    return (await session.execute(stmt)).scalars().first()


__all__ = [
    "upsert_file_usage",
    "delete_usages_by_file_id",
    "sync_usage_from_shot_context",
    "sync_usage_from_character",
    "list_files_by_scope_paginated",
    "first_project_id_for_scene",
    "first_project_id_for_prop",
    "first_project_id_for_costume",
    "first_project_id_for_actor",
]
