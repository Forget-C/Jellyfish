"""Chapter CRUD（从 projects.py 拆分）。"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.dependencies import get_db
from app.models.studio import Chapter, Project, Shot
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, paginated_response, success_response
from app.services.common import (
    create_and_refresh,
    delete_if_exists,
    entity_already_exists,
    entity_not_found,
    ensure_not_exists,
    flush_and_refresh,
    get_or_404,
    patch_model,
    require_entity,
)
from app.api.v1.routes.film.common import TaskCreated, _CreateOnlyTask
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.models.task_links import GenerationTaskLink
from app.schemas.studio.chapter_timeline import (
    ChapterTimelineExportRequest,
    ChapterTimelineRead,
    ChapterTimelineWrite,
)
from app.schemas.studio.projects import ChapterCreate, ChapterRead, ChapterUpdate
from app.services.studio.chapter_timeline import (
    TimelineLayoutConflictError,
    build_timeline_read,
    replace_timeline_segments,
)
from app.services.studio.chapter_timeline_export import (
    EXPORT_RELATION_TYPE,
    EXPORT_RESOURCE_TYPE,
    ensure_timeline_exportable,
    find_active_chapter_timeline_export_task_id,
)
from app.tasks.execute_task import enqueue_task_execution

router = APIRouter()

CHAPTER_ORDER_FIELDS = {"index", "title", "created_at", "updated_at", "storyboard_count", "status"}


@router.get(
    "/{chapter_id}/timeline",
    response_model=ApiResponse[ChapterTimelineRead],
    summary="获取章节剪辑时间线（含镜头成片解析状态）",
)
async def get_chapter_timeline(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ChapterTimelineRead]:
    await get_or_404(db, Chapter, chapter_id, detail=entity_not_found("Chapter"))
    data = await build_timeline_read(db, chapter_id)
    return success_response(data)


@router.put(
    "/{chapter_id}/timeline",
    response_model=ApiResponse[ChapterTimelineRead],
    summary="全量保存章节剪辑时间线片段顺序",
)
async def put_chapter_timeline(
    chapter_id: str,
    body: ChapterTimelineWrite,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ChapterTimelineRead]:
    await get_or_404(db, Chapter, chapter_id, detail=entity_not_found("Chapter"))
    try:
        data = await replace_timeline_segments(db, chapter_id, body)
    except TimelineLayoutConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "layout_version conflict",
                "server_layout_version": exc.server_version,
                "client_layout_version": exc.client_version,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return success_response(data)


@router.post(
    "/{chapter_id}/timeline/export",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="发起章节时间线拼接导出任务",
)
async def post_chapter_timeline_export(
    chapter_id: str,
    body: ChapterTimelineExportRequest | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    await get_or_404(db, Chapter, chapter_id, detail=entity_not_found("Chapter"))
    read = await build_timeline_read(db, chapter_id)
    try:
        ensure_timeline_exportable(read)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    active = await find_active_chapter_timeline_export_task_id(db, chapter_id)
    if active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "章节时间线导出任务进行中",
                "task_id": active,
            },
        )

    eff = body or ChapterTimelineExportRequest()
    store = SqlAlchemyTaskStore(db)
    tm = TaskManager(store=store, strategies={})
    task_record = await tm.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        task_kind="chapter_timeline_export",
        run_args={
            "chapter_id": chapter_id,
            "encode_mode": eff.encode_mode.value,
            "idempotency_key": eff.idempotency_key,
        },
    )
    db.add(
        GenerationTaskLink(
            task_id=task_record.id,
            resource_type=EXPORT_RESOURCE_TYPE,
            relation_type=EXPORT_RELATION_TYPE,
            relation_entity_id=chapter_id,
        ),
    )
    await db.commit()
    enqueue_task_execution(task_record.id)
    return created_response(TaskCreated(task_id=task_record.id))


@router.get(
    "",
    response_model=ApiResponse[PaginatedData[ChapterRead]],
    summary="章节列表（分页）",
)
async def list_chapters(
    db: AsyncSession = Depends(get_db),
    project_id: str | None = Query(None, description="按项目过滤"),
    q: str | None = Query(None, description="关键字，过滤 title/summary"),
    order: str | None = Query(None, description="排序字段"),
    is_desc: bool = Query(False, description="是否倒序"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> ApiResponse[PaginatedData[ChapterRead]]:
    stmt = select(Chapter)
    if project_id:
        stmt = stmt.where(Chapter.project_id == project_id)
    stmt = apply_keyword_filter(stmt, q=q, fields=[Chapter.title, Chapter.summary])
    stmt = apply_order(
        stmt,
        model=Chapter,
        order=order,
        is_desc=is_desc,
        allow_fields=CHAPTER_ORDER_FIELDS,
        default="index",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)

    chapter_ids = [c.id for c in items]
    shot_count_by_chapter: dict[str, int] = {}
    if chapter_ids:
        count_stmt = (
            select(Shot.chapter_id, func.count(Shot.id))
            .where(Shot.chapter_id.in_(chapter_ids))
            .group_by(Shot.chapter_id)
        )
        res = await db.execute(count_stmt)
        shot_count_by_chapter = {str(ch_id): int(cnt) for ch_id, cnt in res.all()}

    return paginated_response(
        [
            ChapterRead.model_validate(x).model_copy(update={"shot_count": shot_count_by_chapter.get(x.id, 0)})
            for x in items
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.post(
    "",
    response_model=ApiResponse[ChapterRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建章节",
)
async def create_chapter(
    body: ChapterCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ChapterRead]:
    await ensure_not_exists(
        db,
        Chapter,
        body.id,
        detail=entity_already_exists("Chapter"),
    )
    await require_entity(
        db,
        Project,
        body.project_id,
        detail=entity_not_found("Project"),
        status_code=400,
    )
    obj = await create_and_refresh(db, Chapter(**body.model_dump()))
    return created_response(ChapterRead.model_validate(obj))


@router.get(
    "/{chapter_id}",
    response_model=ApiResponse[ChapterRead],
    summary="获取章节",
)
async def get_chapter(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ChapterRead]:
    obj = await get_or_404(db, Chapter, chapter_id, detail=entity_not_found("Chapter"))
    count_stmt = select(func.count(Shot.id)).where(Shot.chapter_id == chapter_id)
    res = await db.execute(count_stmt)
    shot_count = int(res.scalar() or 0)
    return success_response(ChapterRead.model_validate(obj).model_copy(update={"shot_count": shot_count}))


@router.patch(
    "/{chapter_id}",
    response_model=ApiResponse[ChapterRead],
    summary="更新章节",
)
async def update_chapter(
    chapter_id: str,
    body: ChapterUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ChapterRead]:
    obj = await get_or_404(db, Chapter, chapter_id, detail=entity_not_found("Chapter"))
    update = body.model_dump(exclude_unset=True)
    if "project_id" in update:
        await require_entity(
            db,
            Project,
            update["project_id"],
            detail=entity_not_found("Project"),
            status_code=400,
        )
    patch_model(obj, update)
    await flush_and_refresh(db, obj)
    return success_response(ChapterRead.model_validate(obj))


@router.delete(
    "/{chapter_id}",
    response_model=ApiResponse[None],
    summary="删除章节",
)
async def delete_chapter(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_if_exists(db, Chapter, chapter_id)
    return empty_response()
