"""文本实验室固定执行、流式与取消接口的请求契约。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TextLabRunRequest(BaseModel):
    """提交一轮文本实验的用户输入；会话和交付方式由固定路径绑定。"""

    model_config = ConfigDict(extra="forbid")

    model_id: str = Field(..., min_length=1, description="已登记的文本模型 ID")
    content: str = Field(..., min_length=1, description="本轮用户输入，不接受客户端拼装的历史消息")


class TextLabCancelRequest(BaseModel):
    """请求停止当前实验会话中的隐藏流式运行。"""

    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=255, description="可选的用户可见取消原因")


class TextLabRunStatus(BaseModel):
    """返回隐藏文本运行的最小状态，不将其暴露到任务中心。"""

    task_id: str = Field(..., min_length=1)
    status: Literal["streaming", "succeeded", "failed", "cancelled"]
