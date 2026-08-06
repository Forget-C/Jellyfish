"""ExecutionAttempt 的当前物理存储兼容别名。"""

from __future__ import annotations

from typing import TypeAlias

from app.models.generation_run_dispatches import GenerationRunDispatch
from app.models.generation_runs import GenerationRun

# P1 不新建重复表：generation_runs 已是当前 durable async Attempt 的物理存储。
# 仅保留图片/视频的历史命名与 Artifact 外键兼容；未来新任务应依赖中立名称。
ExecutionAttempt: TypeAlias = GenerationRun
ExecutionAttemptDispatch: TypeAlias = GenerationRunDispatch

__all__ = ["ExecutionAttempt", "ExecutionAttemptDispatch"]
