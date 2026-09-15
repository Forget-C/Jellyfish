"""批量预检固定本轮输入，任务状态继续由通用任务系统维护。"""
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, unique


class BatchItemInput(Contract):
    """一项批量选择固定的提示词和审稿版本，不允许提交额外执行文本。"""

    prompt_revision_id: Identity
    review_revision_id: Identity


class BatchPrepare(Contract):
    """固定本轮选择顺序，预检不代表已经授权模型执行。"""

    items: list[BatchItemInput] = Field(min_length=1, max_length=20)

    @model_validator(mode='after')
    def distinct_prompts(self):
        """同一提示词在一批中只能出现一次，避免误操作产生重复费用。"""
        unique([item.prompt_revision_id for item in self.items], 'batch prompt')
        return self


class BatchItemRead(BatchItemInput):
    """展示固定范围和当前通用任务状态；预检错误不伪装成已创建的失败任务。"""

    ordinal: int
    plan_revision_id: Identity
    unit_id: Identity
    model_id: Identity
    duration_ms: int
    ratio: str
    task_id: Identity | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    status: Literal['ready', 'blocked', 'queued', 'running', 'succeeded', 'failed', 'cancelled']
    error: str | None = None


class BatchRead(Contract):
    """可恢复的批量受理记录，重复提交同一批不增加任务。"""

    id: Identity
    sequence_id: Identity
    version: int
    status: Literal['prepared', 'submitted']
    created_at: datetime
    items: list[BatchItemRead]
