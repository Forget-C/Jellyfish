"""统一生成执行尝试的生命周期契约。"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot


class GenerationRunStatus(str, Enum):
    """一次执行尝试的封闭状态机。"""

    queued = "queued"
    claimed = "claimed"
    executing = "executing"
    terminalizing = "terminalizing"
    terminal = "terminal"


class GenerationWorkerCallbackKind(str, Enum):
    """Worker 返回给生命周期协调器的唯一终态事件类型。"""

    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class GenerationWorkerCommand(BaseModel):
    """Executor 交给 Worker 的只读执行命令，携带不可伪造的 fencing 上下文。"""

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1)
    task_id: str = Field(min_length=1)
    lease_epoch: int = Field(ge=1)
    lease_owner: str = Field(min_length=1)
    lease_ttl_seconds: int = Field(gt=0)
    provider_idempotency_key: str | None = None
    operation: GenerationOperation
    snapshot: ResolvedGenerationSnapshot
    cancel_requested: bool = False


class GenerationWorkerCallback(BaseModel):
    """Worker 的无业务终态回调；epoch 用于拒绝失效执行者的迟到写入。"""

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1)
    lease_epoch: int = Field(ge=1)
    kind: GenerationWorkerCallbackKind
    provider_task_id: str | None = None
    error_code: str | None = None
    error: str | None = None


__all__ = [
    "GenerationRunStatus",
    "GenerationWorkerCallback",
    "GenerationWorkerCallbackKind",
    "GenerationWorkerCommand",
]
