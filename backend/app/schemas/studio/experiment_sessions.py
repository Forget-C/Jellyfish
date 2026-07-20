"""实验室会话与消息 API 契约。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

LabType = Literal["text", "image", "video"]
MessageRole = Literal["user", "assistant", "task"]


class ExperimentSessionCreate(BaseModel):
    """创建一个实验室会话。"""

    lab_type: LabType
    title: str = Field("新会话", min_length=1, max_length=255)


class ExperimentSessionUpdate(BaseModel):
    """更新用户可见的会话标题。"""

    title: str = Field(..., min_length=1, max_length=255)


class ExperimentSessionRead(BaseModel):
    """会话列表和详情的展示结构。"""

    id: str
    lab_type: LabType
    title: str
    created_at: datetime
    updated_at: datetime
    last_message_preview: str | None = None
    has_running_task: bool = False
    model_config = ConfigDict(from_attributes=True)


class ExperimentMessageCreate(BaseModel):
    """写入一条仅用于用户历史展示的消息。"""

    role: MessageRole
    content: str = ""
    status: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    task_id: str | None = None


class ExperimentMessageUpdate(BaseModel):
    """回写异步任务的用户可见状态与展示结果。"""

    content: str | None = None
    status: str | None = None
    payload: dict[str, Any] | None = None


class ExperimentMessageRead(ExperimentMessageCreate):
    """持久化消息的展示结构。"""

    id: str
    session_id: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)
