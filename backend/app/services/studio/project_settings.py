"""项目设置和封面变更的事务边界。"""
from fastapi import HTTPException, UploadFile
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Project
from app.models.types import ProjectStyle, ProjectVisualStyle
from app.schemas.studio.projects import ProjectUpdate
from app.services.common import entity_not_found, flush_and_refresh, get_or_404, patch_model
from app.services.studio.project_cover import prepare_cover, require_cover_source, retire_cover


def build_project_style_options() -> tuple[dict[ProjectVisualStyle, list[ProjectStyle]], dict[ProjectVisualStyle, ProjectStyle]]:
    mapping: dict[ProjectVisualStyle, list[ProjectStyle]] = {key: [] for key in ProjectVisualStyle}
    for item in ProjectStyle:
        if item.name.startswith("real_people_"):
            mapping[ProjectVisualStyle.live_action].append(item)
            continue
        if item.name.startswith("anime_") or item.name in {"guoman", "ink_wash"}:
            mapping[ProjectVisualStyle.anime].append(item)
            continue
    defaults: dict[ProjectVisualStyle, ProjectStyle] = {
        visual: styles[0]
        for visual, styles in mapping.items()
        if styles
    }
    return mapping, defaults


def validate_project_style_combo(*, visual_style: ProjectVisualStyle, style: ProjectStyle) -> None:
    mapping, _defaults = build_project_style_options()
    allowed = mapping.get(visual_style, [])
    if style not in allowed:
        raise ValueError(
            f"style is not allowed for visual_style: visual_style={visual_style.value}, "
            f"style={style.value}, allowed={[item.value for item in allowed]}"
        )


async def _lock_project(db: AsyncSession, project_id: str) -> Project | None:
    if db.get_bind().dialect.name == "sqlite":
        await db.execute(update(Project).where(Project.id == project_id).values(updated_at=Project.updated_at))
    return await db.get(Project, project_id, with_for_update=True, populate_existing=True)


def _validate_settings(project: Project, changes: dict) -> None:
    visual_style = changes.get("visual_style", project.visual_style)
    style = changes.get("style", project.style)
    if visual_style is not None and style is not None:
        try:
            validate_project_style_combo(visual_style=visual_style, style=style)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc


async def save_project(
    db: AsyncSession, project_id: str, body: ProjectUpdate, file: UploadFile | None = None,
) -> Project:
    """原子保存设置、封面指针和清理登记。对象存储 I/O 在写锁前完成。"""
    changes = body.model_dump(exclude_unset=True)
    cover_changed = "cover_file_id" in changes or file is not None
    source_id = changes.pop("cover_file_id", None)
    not_found = entity_not_found("Project")
    project = await get_or_404(db, Project, project_id, detail=not_found)
    _validate_settings(project, changes)
    if cover_changed:
        cover = await prepare_cover(db, source_id, file)
        # MySQL 文件引用先锁文件再取得项目外键锁；SQLite 先获取数据库写锁。
        sqlite = db.get_bind().dialect.name == "sqlite"
        if source_id is not None and not sqlite:
            await require_cover_source(db, source_id)
        project = await _lock_project(db, project_id)
        if project is None:
            raise HTTPException(404, not_found)
        if source_id is not None and sqlite:
            await require_cover_source(db, source_id)
        _validate_settings(project, changes)
        previous = project.cover_file_id
        if cover is not None:
            db.add(cover)
            await db.flush()
        project.cover_file_id = cover.id if cover is not None else None
        await retire_cover(db, previous)
    patch_model(project, changes)
    return await flush_and_refresh(db, project)


async def remove_project(db: AsyncSession, project_id: str) -> None:
    """沿用画布删除守卫，在删除项目的事务内登记私有封面清理。"""
    from app.services.generation_canvas.runtime import ensure_project_idle

    await ensure_project_idle(db, project_id)
    project = await _lock_project(db, project_id)
    if project is not None:
        await retire_cover(db, project.cover_file_id)
        await db.delete(project)
        await db.flush()
