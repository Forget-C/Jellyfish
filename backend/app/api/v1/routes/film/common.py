"""film 路由公共模型与工具：请求体、任务视图、绑定工具。"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.contracts.task import TaskStatus


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



class EntityExtractTaskRequest(EntityExtractRequest, BindTarget):
    """实体抽取任务请求：在抽取参数基础上增加绑定目标。"""


class ShotlistExtractTaskRequest(ShotlistExtractRequest, BindTarget):
    """分镜抽取任务请求：在抽取参数基础上增加绑定目标。"""


class ShotFramePromptRequest(BaseModel):
    """镜头分镜帧提示词生成任务请求。"""

    frame_type: str = Field(..., description="first | last | key")


class TaskCreated(BaseModel):
    task_id: str = Field(..., description="任务 ID")


class AsyncTaskCreateRead(BaseModel):
    task_id: str = Field(..., description="任务 ID")
    status: TaskStatus = Field(..., description="任务状态")
    reused: bool = Field(False, description="是否复用了当前业务实体已有的活跃任务")
    relation_type: str | None = Field(None, description="业务关联类型")
    relation_entity_id: str | None = Field(None, description="业务关联实体 ID")
