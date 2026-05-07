"""film 路由公共模型与工具：请求体、任务视图、绑定工具。"""

from __future__ import annotations

from typing import Tuple

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter, Project, Shot
from app.services.common import entity_not_found
from app.models.task_links import GenerationTaskLink
from app.core.task_manager.types import TaskStatus


class TextChunkInput(BaseModel):
    """单个文本块。"""

    chunk_id: str = Field(..., description="块 ID，如 chapter1_p03")
    text: str = Field(..., description="原文内容")


class EntityExtractRequest(BaseModel):
    """实体抽取请求。"""

    source_id: str = Field(..., description="小说/章节标识，如 novel_ch01")
    language: str | None = Field(None, description="语言，如 zh / en")
    chunks: list[TextChunkInput] = Field(..., description="文本块列表")


class ShotlistExtractRequest(BaseModel):
    """分镜抽取请求。"""

    source_id: str = Field(..., description="小说/章节标识")
    source_title: str | None = Field(None, description="书名/章节名")
    language: str | None = Field(None, description="语言，如 zh / en")
    chunks: list[TextChunkInput] = Field(..., description="文本块列表")


class BindTarget(BaseModel):
    """任务绑定对象：三选一。"""

    project_id: str | None = Field(None, description="绑定项目 ID（可选）")
    chapter_id: str | None = Field(None, description="绑定章节 ID（可选）")
    shot_id: str | None = Field(None, description="绑定镜头 ID（可选）")


class EntityExtractTaskRequest(EntityExtractRequest, BindTarget):
    """实体抽取任务请求：在抽取参数基础上增加绑定目标。"""


class ShotlistExtractTaskRequest(ShotlistExtractRequest, BindTarget):
    """分镜抽取任务请求：在抽取参数基础上增加绑定目标。"""


class ShotFramePromptRequest(BaseModel):
    """镜头分镜帧提示词生成任务请求。"""

    shot_id: str = Field(..., description="镜头 ID")
    frame_type: str = Field(..., description="first | last | key")


class TaskCreated(BaseModel):
    task_id: str = Field(..., description="任务 ID")


class AsyncTaskCreateRead(BaseModel):
    task_id: str = Field(..., description="任务 ID")
    status: TaskStatus = Field(..., description="任务状态")
    reused: bool = Field(False, description="是否复用了当前业务实体已有的活跃任务")
    relation_type: str | None = Field(None, description="业务关联类型")
    relation_entity_id: str | None = Field(None, description="业务关联实体 ID")


class TaskStatusRead(BaseModel):
    task_id: str
    status: TaskStatus
    progress: int = Field(..., ge=0, le=100)
    cancel_requested: bool = Field(False, description="是否已请求取消")
    cancel_requested_at_ts: float | None = Field(None, description="请求取消时间戳")
    started_at_ts: float | None = Field(None, description="任务开始执行时间戳")
    finished_at_ts: float | None = Field(None, description="任务结束时间戳")
    elapsed_ms: int | None = Field(None, description="任务累计执行耗时（毫秒）")
    error: str = Field("", description="失败时的错误信息（成功/进行中通常为空）")


class TaskListItemRead(BaseModel):
    task_id: str
    task_kind: str = Field(..., description="业务任务类型")
    status: TaskStatus
    progress: int = Field(..., ge=0, le=100)
    cancel_requested: bool = Field(False, description="是否已请求取消")
    cancel_requested_at_ts: float | None = Field(None, description="请求取消时间戳")
    started_at_ts: float | None = Field(None, description="任务开始执行时间戳")
    finished_at_ts: float | None = Field(None, description="任务结束时间戳")
    elapsed_ms: int | None = Field(None, description="任务累计执行耗时（毫秒）")
    created_at_ts: float | None = Field(None, description="任务创建时间戳")
    updated_at_ts: float | None = Field(None, description="任务更新时间戳")
    executor_type: str | None = Field(None, description="执行器类型，如 celery")
    executor_task_id: str | None = Field(None, description="执行器侧任务 ID")
    relation_type: str | None = Field(None, description="业务关联类型")
    relation_entity_id: str | None = Field(None, description="业务关联实体 ID")
    resource_type: str | None = Field(None, description="资源类型")
    navigate_relation_type: str | None = Field(None, description="前端默认跳转关联类型")
    navigate_relation_entity_id: str | None = Field(None, description="前端默认跳转关联实体 ID")


class TaskResultRead(BaseModel):
    task_id: str
    status: TaskStatus
    progress: int = Field(..., ge=0, le=100)
    result: dict | None = None
    error: str = ""
    cancel_requested: bool = Field(False, description="是否已请求取消")
    cancel_requested_at_ts: float | None = Field(None, description="请求取消时间戳")
    started_at_ts: float | None = Field(None, description="任务开始执行时间戳")
    finished_at_ts: float | None = Field(None, description="任务结束时间戳")
    elapsed_ms: int | None = Field(None, description="任务累计执行耗时（毫秒）")


class TaskCancelRequest(BaseModel):
    reason: str | None = Field(None, description="取消原因（可选）")


class TaskCancelRead(BaseModel):
    task_id: str
    status: TaskStatus
    cancel_requested: bool = Field(..., description="是否已登记取消请求")
    cancel_requested_at_ts: float | None = Field(None, description="请求取消时间戳")
    effective_immediately: bool = Field(False, description="是否已立即取消完成")


class TaskLinkAdoptRequest(BindTarget):
    """更新采用状态请求：task_id + 三选一绑定对象（project_id/chapter_id/shot_id）。"""

    task_id: str = Field(..., description="任务 ID")


class TaskLinkAdoptRead(BaseModel):
    """采用状态更新结果。"""

    task_id: str
    link_type: str = Field(..., description="project | chapter | shot")
    entity_id: str = Field(..., description="项目/章节/镜头 ID")
    is_adopted: bool = Field(..., description="是否采用（仅可正向变更为 true）")


class _CreateOnlyTask:
    """仅用于 TaskManager.create：提供 __class__.__name__，避免传入 lambda。"""

    async def run(self, *args: object, **kwargs: object):  # noqa: ANN001, ANN003
        return None

    async def status(self) -> dict[str, object]:
        return {}

    async def is_done(self) -> bool:
        return False

    async def get_result(self) -> object:
        return None


def ensure_single_bind_target(body: BindTarget) -> Tuple[str, str]:
    """校验并返回 (target_type, target_id)。"""
    targets = [
        ("project", body.project_id),
        ("chapter", body.chapter_id),
        ("shot", body.shot_id),
    ]
    provided = [(t, v) for (t, v) in targets if v]
    if len(provided) != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide exactly one of project_id/chapter_id/shot_id",
        )
    return provided[0][0], provided[0][1]  # type: ignore[return-value]


async def bind_task(
    db: AsyncSession,
    *,
    task_id: str,
    target_type: str,
    target_id: str,
    relation_type: str,
) -> None:
    """在 studio 域与 GenerationTask 之间建立关联。

    目前 target_type 仍是 project/chapter/shot 三选一，这里保持校验逻辑不变，
    但不再在关联表中保存 project_id/chapter_id/shot_id，而是通过：
    - resource_type: 固定为 "task_link"（上层按需扩展）
    - relation_type: 使用调用方传入的业务类型（如 entities/shotlist/shot_first_frame_prompt 等）
    - relation_entity_id: 使用具体的业务实体 ID（目前为 project_id/chapter_id/shot_id）
    """
    if target_type == "project":
        if await db.get(Project, target_id) is None:
            raise HTTPException(status_code=404, detail=entity_not_found("Project"))
        db.add(
            GenerationTaskLink(
                task_id=task_id,
                resource_type="task_link",
                relation_type=relation_type,
                relation_entity_id=target_id,
            )
        )
        return
    if target_type == "chapter":
        if await db.get(Chapter, target_id) is None:
            raise HTTPException(status_code=404, detail=entity_not_found("Chapter"))
        db.add(
            GenerationTaskLink(
                task_id=task_id,
                resource_type="task_link",
                relation_type=relation_type,
                relation_entity_id=target_id,
            )
        )
        return
    if target_type == "shot":
        if await db.get(Shot, target_id) is None:
            raise HTTPException(status_code=404, detail=entity_not_found("Shot"))
        db.add(
            GenerationTaskLink(
                task_id=task_id,
                resource_type="task_link",
                relation_type=relation_type,
                relation_entity_id=target_id,
            )
        )
        return
    raise HTTPException(status_code=400, detail="Invalid bind target type")
