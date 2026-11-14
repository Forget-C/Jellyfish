"""通用任务查询与取消接口；状态写入统一交由 TaskService。"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.task import TaskStatus
from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.task import TaskCancelRead, TaskCancelRequest, TaskPageRead, TaskResultRead, TaskStatusRead, TaskOutputPageRead, ActorImageParametersRead
from app.services.task_queries import TaskQueries, timestamp
from app.services.task_service import TaskService

router = APIRouter()


@router.get("/tasks", response_model=ApiResponse[TaskPageRead], summary="任务历史与活动任务列表")
async def list_tasks(
    db: AsyncSession = Depends(get_db),
    statuses: list[TaskStatus] | None = Query(None),
    task_kind: str | None = Query(None),
    target_type: str | None = Query(None),
    target_id: str | None = Query(None),
    project_id: str | None = Query(None),
    created_from: datetime | None = Query(None),
    created_before: datetime | None = Query(None),
    recent_seconds: int | None = Query(None, ge=0, le=86400),
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(50, ge=1, le=100),
) -> ApiResponse[TaskPageRead]:
    """按创建时间游标查询，不默认隐藏历史；日期范围为前闭后开。"""
    return success_response(await TaskQueries(db).list(
        statuses=statuses, task_kind=task_kind, target_type=target_type, target_id=target_id,
        project_id=project_id, created_from=created_from, created_before=created_before,
        recent_seconds=recent_seconds, cursor=cursor, limit=limit,
    ))


@router.get("/tasks/outputs", response_model=ApiResponse[TaskOutputPageRead], summary="查询业务目标的生成产物历史")
async def list_task_outputs(
    target_type: str = Query(...), target_id: str = Query(...),
    cursor: str | None = Query(None, max_length=512), limit: int = Query(100, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskOutputPageRead]:
    """业务面板按目标读取输出；实际采用操作仍由对应业务接口完成。"""
    return success_response(await TaskQueries(db).outputs(
        target_type=target_type, target_id=target_id, cursor=cursor, limit=limit,
    ))


@router.get("/tasks/actor-images/{actor_id}/{image_id}/parameters", response_model=ApiResponse[ActorImageParametersRead | None], summary="读取演员图片已有生成参数")
async def get_actor_image_parameters(
    actor_id: str, image_id: int, db: AsyncSession = Depends(get_db),
) -> ApiResponse[ActorImageParametersRead | None]:
    """缺少来源返回空，不创建或补齐参数。"""
    return success_response(await TaskQueries(db).actor_image_parameters(actor_id, image_id))


@router.get("/tasks/asset-images/{entity_type}/{entity_id}/{image_id}/parameters", response_model=ApiResponse[ActorImageParametersRead | None], summary="读取资产图片已有生成参数")
async def get_asset_image_parameters(
    entity_type: str, entity_id: str, image_id: int, db: AsyncSession = Depends(get_db),
) -> ApiResponse[ActorImageParametersRead | None]:
    """仅返回已有来源快照，类别与图片归属由服务校验。"""
    return success_response(await TaskQueries(db).asset_image_parameters(entity_type, entity_id, image_id))


@router.get("/tasks/{task_id}/status", response_model=ApiResponse[TaskStatusRead], summary="查询任务状态与进度")
async def get_task_status(task_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse[TaskStatusRead]:
    """直接返回主表轻量状态。"""
    return success_response(await TaskQueries(db).status(task_id))


@router.get("/tasks/{task_id}/result", response_model=ApiResponse[TaskResultRead], summary="查询任务结果")
async def get_task_result(task_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse[TaskResultRead]:
    """业务面板按需读取任务结果和已保存的部分产物。"""
    return success_response(await TaskQueries(db).result(task_id))


@router.post("/tasks/{task_id}/cancel", response_model=ApiResponse[TaskCancelRead], summary="请求取消任务")
async def cancel_task(
    task_id: str, body: TaskCancelRequest, db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCancelRead]:
    """仅调用统一维护入口；排队任务可立即取消，运行任务登记取消意图。"""
    task = await TaskService(db).request_cancel(task_id, reason=body.reason)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return success_response(TaskCancelRead(
        task_id=task.id, status=task.status, cancel_requested=task.cancel_requested_at is not None,
        cancel_requested_at_ts=timestamp(task.cancel_requested_at),
        effective_immediately=task.status == TaskStatus.cancelled,
    ))
