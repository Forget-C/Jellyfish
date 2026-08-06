"""统一生成的一次执行尝试持久化模型。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin


class GenerationRun(Base, TimestampMixin):
    """当前 ExecutionAttempt 的物理存储；保留媒体历史命名与外键兼容。

    新 durable async 代码应优先依赖 ``ExecutionAttempt`` 类型别名与中立仓储，避免
    再向本表加入媒体、Artifact 或 Provider 专属字段。现有 Provider checkpoint 字段
    将在 P2 迁移到独立 ProviderOperation 后逐步退出。
    """

    __tablename__ = "generation_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("generation_tasks.id", ondelete="CASCADE"), nullable=False)
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    lease_owner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lease_epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    provider_idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    provider_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    callback_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("task_id", "attempt_no", name="uq_generation_runs_task_attempt"),
        Index("ix_generation_runs_task_created", "task_id", "created_at"),
        Index("ix_generation_runs_status_lease", "status", "lease_expires_at"),
    )
