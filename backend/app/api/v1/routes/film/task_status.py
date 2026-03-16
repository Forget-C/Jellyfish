from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel, Field

from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.dependencies import get_db
from app.models.task import GenerationTask
from app.models.task_links import GenerationTaskLink
from app.schemas.common import ApiResponse, success_response

from .common import TaskLinkAdoptRead, TaskLinkAdoptRequest, TaskResultRead, TaskStatusRead, ensure_single_bind_target

router = APIRouter()


class GenerationTaskLinkBase(BaseModel):
    """通用生成任务关联基础信息。"""

    task_id: str = Field(..., description="生成任务 ID")
    resource_type: str = Field(..., description="生成资源类型（如 image/video/text/task_link）")
    relation_type: str = Field(..., description="业务类型（如 prop/costume/scene 等）")
    relation_entity_id: str = Field(..., description="关联业务实体 ID")
    is_adopted: bool = Field(..., description="是否采用（业务侧是否已采纳该任务结果）")


class GenerationTaskLinkCreate(BaseModel):
    """创建生成任务关联请求体。"""

    task_id: str = Field(..., description="生成任务 ID")
    resource_type: str = Field(..., description="生成资源类型（如 image/video/text/task_link）")
    relation_type: str = Field(..., description="业务类型（如 prop/costume/scene 等）")
    relation_entity_id: str = Field(..., description="关联业务实体 ID")
    is_adopted: bool = Field(False, description="是否采用，默认 False。正向更新建议使用专用接口。")


class GenerationTaskLinkUpdate(BaseModel):
    """更新生成任务关联请求体（不包含 is_adopted，采用状态由专用接口正向变更）。"""

    resource_type: str | None = Field(None, description="生成资源类型（如 image/video/text/task_link）")
    relation_type: str | None = Field(None, description="业务类型（如 prop/costume/scene 等）")
    relation_entity_id: str | None = Field(None, description="关联业务实体 ID")


class GenerationTaskLinkRead(GenerationTaskLinkBase):
    """生成任务关联返回体。"""

    id: int = Field(..., description="关联行 ID")

    model_config = {"from_attributes": True}


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
        raise HTTPException(status_code=404, detail="Task not found")
    return success_response(TaskStatusRead(task_id=view.id, status=view.status, progress=view.progress))


@router.get(
    "/tasks/{task_id}/result",
    response_model=ApiResponse[TaskResultRead],
    summary="获取任务结果",
)
async def get_task_result(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskResultRead]:
    row = await db.get(GenerationTask, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")
    status_value = row.status.value if hasattr(row.status, "value") else str(row.status)
    return success_response(
        TaskResultRead(
            task_id=row.id,
            status=TaskStatus(status_value),
            progress=int(row.progress),
            result=row.result,
            error=row.error or "",
        )
    )


@router.patch(
    "/task-links/adopt",
    response_model=ApiResponse[TaskLinkAdoptRead],
    summary="更新任务关联的采用状态（仅可正向变更）",
    description="将指定任务链接的 is_adopted 设为 true；已采用不可改为未采用。",
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
        raise HTTPException(status_code=404, detail="Task link not found")

    if link.is_adopted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="状态只可正向变更，已采用不可改为未采用",
        )

    link.is_adopted = True
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
    response_model=ApiResponse[list[GenerationTaskLinkRead]],
    summary="生成任务关联列表（支持多条件过滤）",
)
async def list_task_links(
    db: AsyncSession = Depends(get_db),
    resource_type: str | None = Query(None, description="按 resource_type 过滤"),
    relation_type: str | None = Query(None, description="按 relation_type 过滤"),
    relation_entity_id: str | None = Query(None, description="按 relation_entity_id 过滤"),
    is_adopted: bool | None = Query(None, description="按是否采用过滤"),
    task_id: str | None = Query(None, description="按 task_id 过滤"),
) -> ApiResponse[list[GenerationTaskLinkRead]]:
    stmt = select(GenerationTaskLink)
    if resource_type is not None:
        stmt = stmt.where(GenerationTaskLink.resource_type == resource_type)
    if relation_type is not None:
        stmt = stmt.where(GenerationTaskLink.relation_type == relation_type)
    if relation_entity_id is not None:
        stmt = stmt.where(GenerationTaskLink.relation_entity_id == relation_entity_id)
    if is_adopted is not None:
        stmt = stmt.where(GenerationTaskLink.is_adopted == is_adopted)
    if task_id is not None:
        stmt = stmt.where(GenerationTaskLink.task_id == task_id)

    result = await db.execute(stmt)
    links = result.scalars().all()
    return success_response([GenerationTaskLinkRead.model_validate(x) for x in links])


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
        is_adopted=body.is_adopted,
    )
    db.add(link)
    await db.flush()
    await db.refresh(link)
    return success_response(GenerationTaskLinkRead.model_validate(link), code=201)


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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task link not found")
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task link not found")
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
        return success_response(None)
    await db.delete(link)
    await db.flush()
    return success_response(None)

