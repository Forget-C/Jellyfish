"""首页跨项目画布与资产库的限量摘要查询。"""
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import and_, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.directing import Sequence
from app.models.generation_canvas import GenerationCanvas
from app.models.studio import Chapter, Project
from app.schemas.studio.home import HomeRecentAsset, HomeRecentCanvas
from app.services.studio.entity_specs import entity_spec
from app.services.studio.entity_thumbnails import resolve_thumbnails


def _timestamp_column(db: AsyncSession, column):
    """MySQL 按会话时区把 DATETIME 转为时间戳；SQLite 的 CURRENT_TIMESTAMP 已使用 UTC。"""
    if db.get_bind().dialect.name == "mysql":
        return func.unix_timestamp(column).label("display_updated_at")
    return column.label("display_updated_at")


def _updated_at(value: datetime | int | Decimal) -> datetime:
    if isinstance(value, datetime):
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return datetime.fromtimestamp(float(value), UTC)


async def recent_canvases(db: AsyncSession) -> list[HomeRecentCanvas]:
    """读取最近保存的独立画布及仍有有效场次归属的画布。"""
    canvas = GenerationCanvas
    recent = (
        select(canvas.id, canvas.updated_at, canvas.kind, Project.name.label("project_name"))
        .outerjoin(Project, Project.id == canvas.project_id)
        .outerjoin(Sequence, Sequence.id == canvas.sequence_id)
        .outerjoin(Chapter, and_(Chapter.id == Sequence.chapter_id, Chapter.project_id == Project.id))
        .where(or_(
            and_(canvas.kind == "free", canvas.project_id.is_(None)),
            and_(canvas.kind == "scene", Chapter.id.is_not(None)),
        ))
        .order_by(canvas.updated_at.desc(), canvas.id.desc())
        .limit(3)
        .subquery()
    )
    # 先限制结果，再读取 JSON 字段，避免将大文档带入数据库排序。
    rows = await db.execute(
        select(
            recent.c.id, recent.c.kind, recent.c.project_name,
            _timestamp_column(db, recent.c.updated_at),
            canvas.document["name"].as_string().label("name"),
            func.nullif(canvas.document["cover_file_id"].as_string(), "null").label("cover_file_id"),
        )
        .join(canvas, canvas.id == recent.c.id)
        .order_by(recent.c.updated_at.desc(), recent.c.id.desc())
    )
    return [
        HomeRecentCanvas(
            id=row.id, kind=row.kind, name=row.name, updated_at=_updated_at(row.display_updated_at),
            cover_file_id=row.cover_file_id, project_name=row.project_name,
        )
        for row in rows
    ]


async def recent_assets(db: AsyncSession) -> list[HomeRecentAsset]:
    """合并四类库内资产，按档案更新时间取前六项并批量补齐缩略图。"""
    specs = {kind: entity_spec(kind) for kind in ("actor", "scene", "prop", "costume")}
    candidates = union_all(*(
        select(literal(kind).label("type"), spec.model.id, spec.model.name, spec.model.updated_at)
        .where(spec.model.project_id.is_(None))
        for kind, spec in specs.items()
    )).subquery()
    rows = (await db.execute(
        select(candidates.c.id, candidates.c.type, candidates.c.name, _timestamp_column(db, candidates.c.updated_at))
        .order_by(candidates.c.updated_at.desc(), candidates.c.type, candidates.c.id)
        .limit(6)
    )).all()
    thumbnails = {
        kind: await resolve_thumbnails(
            db, image_model=spec.image_model, parent_field_name=spec.id_field,
            parent_ids=[row.id for row in rows if row.type == kind],
        )
        for kind, spec in specs.items()
    }
    return [
        HomeRecentAsset(
            id=row.id, type=row.type, name=row.name, updated_at=_updated_at(row.display_updated_at),
            thumbnail=thumbnails[row.type].get(row.id),
        )
        for row in rows
    ]
