from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel, Field

from app.api.utils import apply_order, paginate
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.dependencies import get_db
from app.models.task_links import GenerationTaskLink
from app.models.experiment_sessions import ExperimentMessage
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, paginated_response, success_response
from app.services.common import entity_not_found
from app.tasks.execute_task import revoke_task_execution

from .common import (
    TaskCancelRead,
    TaskCancelRequest,
    TaskLinkAdoptRead,
    TaskLinkAdoptRequest,
    TaskListItemRead,
    TaskResultRead,
    TaskStatusRead,
    ensure_single_bind_target,
)

router = APIRouter()
TASK_LINK_ORDER_FIELDS = {"updated_at", "created_at", "id", "status"}


class GenerationTaskLinkBase(BaseModel):
    """通用生成任务关联基础信息。"""

    task_id: str = Field(..., description="生成任务 ID")
    resource_type: str = Field(..., description="生成资源类型（如 image/video/text/task_link）")
    relation_type: str = Field(..., description="业务类型（如 prop/costume/scene 等）")
    relation_entity_id: str = Field(..., description="关联业务实体 ID")
    file_id: str | None = Field(None, description="关联产物文件 ID（files.id；适用于图片/音频/视频）")
    status: str = Field(..., description="关联状态：accepted=已采用、todo=待操作、rejected=未采用")


class GenerationTaskLinkCreate(BaseModel):
    """创建生成任务关联请求体。"""

    task_id: str = Field(..., description="生成任务 ID")
    resource_type: str = Field(..., description="生成资源类型（如 image/video/text/task_link）")
    relation_type: str = Field(..., description="业务类型（如 prop/costume/scene 等）")
    relation_entity_id: str = Field(..., description="关联业务实体 ID")
    file_id: str | None = Field(None, description="关联产物文件 ID（files.id；适用于图片/音频/视频）")
    status: str = Field("todo", description="关联状态：accepted=已采用、todo=待操作、rejected=未采用；默认 todo")


class GenerationTaskLinkUpdate(BaseModel):
    """更新生成任务关联请求体（不包含 is_adopted，采用状态由专用接口正向变更）。"""

    resource_type: str | None = Field(None, description="生成资源类型（如 image/video/text/task_link）")
    relation_type: str | None = Field(None, description="业务类型（如 prop/costume/scene 等）")
    relation_entity_id: str | None = Field(None, description="关联业务实体 ID")
    file_id: str | None = Field(None, description="关联产物文件 ID（files.id；适用于图片/音频/视频）")
    status: str | None = Field(None, description="关联状态：accepted=已采用、todo=待操作、rejected=未采用")


class GenerationTaskLinkRead(GenerationTaskLinkBase):
    """生成任务关联返回体。"""

    id: int = Field(..., description="关联行 ID")

    model_config = {"from_attributes": True}


@router.get(
    "/tasks",
    response_model=ApiResponse[PaginatedData[TaskListItemRead]],
    summary="全局任务列表（任务中心）",
)
async def list_tasks(
    db: AsyncSession = Depends(get_db),
    statuses: list[TaskStatus] | None = Query(None, description="按任务状态过滤，可多选"),
    task_kind: str | None = Query(None, description="按 task_kind 过滤"),
    relation_type: str | None = Query(None, description="按 relation_type 过滤"),
    relation_entity_id: str | None = Query(None, description="按 relation_entity_id 过滤"),
    recent_seconds: int = Query(300, ge=0, le=86400, description="默认返回最近结束任务的时间窗口（秒）"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页条数"),
) -> ApiResponse[PaginatedData[TaskListItemRead]]:
    store = SqlAlchemyTaskStore(db)
    items, total = await store.list_task_views(
        statuses=statuses,
        task_kind=task_kind,
        relation_type=relation_type,
        relation_entity_id=relation_entity_id,
        recent_seconds=recent_seconds,
        page=page,
        page_size=page_size,
    )
    return paginated_response(
        [
            TaskListItemRead(
                task_id=item.id,
                task_kind=item.task_kind,
                status=item.status,
                progress=item.progress,
                cancel_requested=item.cancel_requested,
                cancel_requested_at_ts=item.cancel_requested_at_ts,
                started_at_ts=item.started_at_ts,
                finished_at_ts=item.finished_at_ts,
                elapsed_ms=item.elapsed_ms,
                created_at_ts=item.created_at_ts,
                updated_at_ts=item.updated_at_ts,
                executor_type=item.executor_type,
                executor_task_id=item.executor_task_id,
                relation_type=item.relation_type,
                relation_entity_id=item.relation_entity_id,
                resource_type=item.resource_type,
                navigate_relation_type=item.navigate_relation_type,
                navigate_relation_entity_id=item.navigate_relation_entity_id,
            )
            for item in items
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get(
    "/tasks/{task_id}/status",
    response_model=ApiResponse[TaskStatusRead],
    summary="查询任务状态/进度（轮询）",
)
async def get_task_status(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskStatusRead]:
    store = SqlAlchemyTaskStore(db)
    view = await store.get_status_view(task_id)
    if view is None:
        raise HTTPException(status_code=404, detail=entity_not_found("Task"))
    return success_response(
        TaskStatusRead(
            task_id=view.id,
            status=view.status,
            progress=view.progress,
            cancel_requested=view.cancel_requested,
            cancel_requested_at_ts=view.cancel_requested_at_ts,
            started_at_ts=view.started_at_ts,
            finished_at_ts=view.finished_at_ts,
            elapsed_ms=view.elapsed_ms,
        )
    )


@router.get(
    "/tasks/{task_id}/result",
    response_model=ApiResponse[TaskResultRead],
    summary="获取任务结果",
)
async def get_task_result(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskResultRead]:
    store = SqlAlchemyTaskStore(db)
    rec = await store.get(task_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=entity_not_found("Task"))
    return success_response(
        TaskResultRead(
            task_id=rec.id,
            status=rec.status,
            progress=rec.progress,
            result=rec.result,
            error=rec.error,
            cancel_requested=rec.cancel_requested,
            cancel_requested_at_ts=rec.cancel_requested_at_ts,
            started_at_ts=rec.started_at_ts,
            finished_at_ts=rec.finished_at_ts,
            elapsed_ms=rec.elapsed_ms,
        )
    )


@router.post(
    "/tasks/{task_id}/cancel",
    response_model=ApiResponse[TaskCancelRead],
    summary="请求取消任务",
)
async def cancel_task(
    task_id: str,
    body: TaskCancelRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCancelRead]:
    store = SqlAlchemyTaskStore(db)
    rec = await store.request_cancel(task_id, body.reason)
    if rec is None:
        raise HTTPException(status_code=404, detail=entity_not_found("Task"))
    effective_immediately = rec.status == TaskStatus.cancelled
    if not effective_immediately and revoke_task_execution(task_id):
        rec = await store.mark_cancelled(task_id)
        if rec is None:
            raise HTTPException(status_code=404, detail=entity_not_found("Task"))
        effective_immediately = True
    if rec.status == TaskStatus.cancelled:
        message_row = (await db.execute(select(ExperimentMessage).where(ExperimentMessage.task_id == task_id))).scalars().first()
        if message_row is not None:
            message_row.status = "cancelled"
            message_row.payload = {**message_row.payload, "error": body.reason or "任务已取消"}
            await db.commit()
    return success_response(
        TaskCancelRead(
            task_id=rec.id,
            status=rec.status,
            cancel_requested=rec.cancel_requested,
            cancel_requested_at_ts=rec.cancel_requested_at_ts,
            effective_immediately=effective_immediately,
        )
    )


@router.patch(
    "/task-links/adopt",
    response_model=ApiResponse[TaskLinkAdoptRead],
    summary="更新任务关联的采用状态（仅可正向变更）",
    description="将指定任务链接的状态设为 accepted；已采用不可改为未采用。",
)
async def adopt_task_link(
    body: TaskLinkAdoptRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskLinkAdoptRead]:
    target_type, entity_id = ensure_single_bind_target(body)

    # 关联表已统一为 GenerationTaskLink，不再区分 project/chapter/shot，直接用 relation_entity_id 反查
    stmt = select(GenerationTaskLink).where(
        GenerationTaskLink.task_id == body.task_id,
        GenerationTaskLink.relation_entity_id == entity_id,
    ).limit(1)
    result = await db.execute(stmt)
    link = result.scalars().first()

    if link is None:
        raise HTTPException(status_code=404, detail=entity_not_found("Task link"))

    if str(link.status) == "accepted":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="状态只可正向变更，已采用不可改为未采用",
        )

    from app.models.task_links import GenerationTaskLinkStatus

    link.status = GenerationTaskLinkStatus.accepted
    await db.flush()

    return success_response(
        TaskLinkAdoptRead(
            task_id=body.task_id,
            link_type=target_type,
            entity_id=entity_id,
            is_adopted=True,
        )
    )


@router.get(
    "/task-links",
    response_model=ApiResponse[PaginatedData[GenerationTaskLinkRead]],
    summary="生成任务关联列表（分页，支持多条件过滤）",
)
async def list_task_links(
    db: AsyncSession = Depends(get_db),
    resource_type: str | None = Query(None, description="按 resource_type 过滤"),
    relation_type: str | None = Query(None, description="按 relation_type 过滤"),
    relation_entity_id: str | None = Query(None, description="按 relation_entity_id 过滤"),
    status: str | None = Query(None, description="按关联状态过滤（accepted/todo/rejected）"),
    task_id: str | None = Query(None, description="按 task_id 过滤"),
    order: str | None = Query(None, description="排序字段：updated_at/created_at/id/status"),
    is_desc: bool = Query(True, description="是否倒序；默认 true"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页条数"),
) -> ApiResponse[PaginatedData[GenerationTaskLinkRead]]:
    stmt = select(GenerationTaskLink)
    if resource_type is not None:
        stmt = stmt.where(GenerationTaskLink.resource_type == resource_type)
    if relation_type is not None:
        stmt = stmt.where(GenerationTaskLink.relation_type == relation_type)
    if relation_entity_id is not None:
        stmt = stmt.where(GenerationTaskLink.relation_entity_id == relation_entity_id)
    if status is not None:
        stmt = stmt.where(GenerationTaskLink.status == status)
    if task_id is not None:
        stmt = stmt.where(GenerationTaskLink.task_id == task_id)
    stmt = apply_order(
        stmt,
        model=GenerationTaskLink,
        order=order,
        is_desc=is_desc,
        allow_fields=TASK_LINK_ORDER_FIELDS,
        default="updated_at",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)
    return paginated_response(
        [GenerationTaskLinkRead.model_validate(x) for x in items],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.post(
    "/task-links",
    response_model=ApiResponse[GenerationTaskLinkRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建生成任务关联",
)
async def create_task_link(
    body: GenerationTaskLinkCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[GenerationTaskLinkRead]:
    link = GenerationTaskLink(
        task_id=body.task_id,
        resource_type=body.resource_type,
        relation_type=body.relation_type,
        relation_entity_id=body.relation_entity_id,
        file_id=body.file_id,
        status=body.status,
    )
    db.add(link)
    await db.flush()
    await db.refresh(link)
    return created_response(GenerationTaskLinkRead.model_validate(link))


@router.get(
    "/task-links/{link_id}",
    response_model=ApiResponse[GenerationTaskLinkRead],
    summary="获取生成任务关联详情",
)
async def get_task_link(
    link_id: int,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[GenerationTaskLinkRead]:
    link = await db.get(GenerationTaskLink, link_id)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Task link"))
    return success_response(GenerationTaskLinkRead.model_validate(link))


@router.patch(
    "/task-links/{link_id}",
    response_model=ApiResponse[GenerationTaskLinkRead],
    summary="更新生成任务关联（不支持直接修改 is_adopted）",
)
async def update_task_link(
    link_id: int,
    body: GenerationTaskLinkUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[GenerationTaskLinkRead]:
    link = await db.get(GenerationTaskLink, link_id)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Task link"))
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(link, k, v)
    await db.flush()
    await db.refresh(link)
    return success_response(GenerationTaskLinkRead.model_validate(link))


@router.delete(
    "/task-links/{link_id}",
    response_model=ApiResponse[None],
    summary="删除生成任务关联",
)
async def delete_task_link(
    link_id: int,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    link = await db.get(GenerationTaskLink, link_id)
    if link is None:
        return empty_response()
    await db.delete(link)
    await db.flush()
    return empty_response()
