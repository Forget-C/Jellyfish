"""GenerationRun 的 Celery 投递与领取审计事件。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.generation_runs import GenerationRun  # noqa: F401


class GenerationRunDispatch(Base, TimestampMixin):
    """以 Celery work_id 为唯一键连接投递、Run 领取与 epoch。"""

    __tablename__ = "generation_run_dispatches"

    work_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("generation_tasks.id", ondelete="CASCADE"), nullable=False)
    generation_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("generation_runs.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="enqueued")
    lease_epoch: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    delivery_lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    enqueued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("generation_run_id", "lease_epoch", name="uq_generation_run_dispatches_run_epoch"),
        Index("ix_generation_run_dispatches_task_created", "task_id", "created_at"),
        Index("ix_generation_run_dispatches_status_delivery_lease", "status", "delivery_lease_expires_at"),
        Index("ix_generation_run_dispatches_run_epoch", "generation_run_id", "lease_epoch"),
    )
