"""镜头分镜帧提示词生成（首帧 / 关键帧 / 尾帧）——**同进程内联执行**。

执行模型（用户实点反馈：「AI 首帧点完一直排队中，任务永远是 pending」）：

- 旧实现只做两件事：建一条 ``GenerationTask`` 行 + ``enqueue_task_execution``（Celery）。
  本机没有 Redis / celery worker（``task_always_eager=False``），所以队列里的任务**永远不会被执行**，
  页面上留下一条卡死的「排队中」。
- 现在改为**本进程事件循环内联执行**（``spawn_inline_task_execution``）：
  任务行照旧建（所以任务中心 / 状态查询 / 结果查询 / 取消全部照旧可用），
  只是执行者从「不存在的 worker」换成「当前进程的后台 asyncio 任务」。
- 拿不到运行中的事件循环时（例如脚本里同步调用这个函数）才退回 ``enqueue_task_execution``，
  这样接口行为在两种环境下都是确定的。
- 付费边界不变：任务体在构造默认文本大模型时会过 ``paid_outlet_guard``（llm 出口），
  DRY_RUN 下会被拦下并把任务如实标成 failed（不会又留下一条假的「执行中」）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.dependencies import get_db
from app.models.task_links import GenerationTaskLink
from app.schemas.common import ApiResponse, created_response
from app.services.film.shot_frame_prompt_tasks import (
    build_run_args as build_shot_frame_prompt_run_args,
    normalize_frame_type,
    relation_type_for_frame,
    run_shot_frame_prompt_task,
)
from app.services.studio.shot_status import mark_shot_generating
from app.tasks.execute_task import enqueue_task_execution, spawn_inline_task_execution

from .common import (
    ShotFramePromptRequest,
    TaskCreated,
    _CreateOnlyTask,
)
router = APIRouter()


@router.post(
    "/tasks/shot-frame-prompts",
    response_model=ApiResponse[TaskCreated],
    status_code=201,
    summary="镜头分镜帧提示词生成（同进程内联执行的任务版）",
)
async def create_shot_frame_prompt_task(
    body: ShotFramePromptRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    frame_type = normalize_frame_type(body.frame_type)
    relation_type = relation_type_for_frame(frame_type)

    store = SqlAlchemyTaskStore(db)
    tm = TaskManager(store=store, strategies={})
    run_args = await build_shot_frame_prompt_run_args(
        db,
        shot_id=body.shot_id,
        frame_type=frame_type,
    )

    task_record = await tm.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        task_kind="shot_frame_prompt",
        run_args=run_args,
    )
    db.add(
        GenerationTaskLink(
            task_id=task_record.id,
            resource_type="prompt",
            relation_type=relation_type,
            relation_entity_id=body.shot_id,
        )
    )
    await mark_shot_generating(db, shot_id=body.shot_id)
    # 先提交任务行：内联执行体用的是**另一个 session**，必须能读到这条任务。
    await db.commit()

    detail = f"镜头分帧提示词生成 shot_id={body.shot_id} frame_type={frame_type}"
    scheduled = spawn_inline_task_execution(
        task_record.id,
        runner=run_shot_frame_prompt_task,
        run_args=run_args,
        detail=detail,
    )
    if not scheduled:
        # 没有运行中的事件循环（同步脚本调用等）→ 退回既有队列入口，行为保持可预期。
        enqueue_task_execution(task_record.id)
    return created_response(TaskCreated(task_id=task_record.id))
