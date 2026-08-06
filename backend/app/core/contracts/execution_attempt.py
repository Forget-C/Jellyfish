"""可恢复异步执行尝试的中立控制面契约。"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class ExecutionAttemptStatus(str, Enum):
    """所有 durable async 尝试共享的封闭控制面状态。"""

    queued = "queued"
    claimed = "claimed"
    executing = "executing"
    terminalizing = "terminalizing"
    terminal = "terminal"


class ExecutionAttemptCallbackKind(str, Enum):
    """Attempt Worker 可回传的无领域终态类型。"""

    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class ExecutionAttemptLease(BaseModel):
    """Worker 执行命令必须携带的 lease fencing 上下文。"""

    model_config = ConfigDict(extra="forbid")

    attempt_id: str = Field(min_length=1)
    task_id: str = Field(min_length=1)
    lease_epoch: int = Field(ge=1)
    lease_owner: str = Field(min_length=1)
    lease_ttl_seconds: int = Field(gt=0)


class ExecutionAttemptCallback(BaseModel):
    """控制面 callback，不携带媒体 Artifact 或特定领域输出。"""

    model_config = ConfigDict(extra="forbid")

    attempt_id: str = Field(min_length=1)
    lease_epoch: int = Field(ge=1)
    kind: ExecutionAttemptCallbackKind
    error_code: str | None = None
    error: str | None = None


__all__ = [
    "ExecutionAttemptCallback",
    "ExecutionAttemptCallbackKind",
    "ExecutionAttemptLease",
    "ExecutionAttemptStatus",
]
