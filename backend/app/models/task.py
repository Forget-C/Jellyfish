"""任务与输入输出关系：本地生命周期只存 tasks，由 TaskService 维护。"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.contracts.task import TaskExecutionMode, TaskStatus
from app.core.db import Base
from app.models.base import TimestampMixin


class Task(Base, TimestampMixin):
    """一次提交的一条执行与历史记录；远端状态是观察值，不是本地终态。"""

    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # 应用写入完整精度时间，避免 SQLite 默认秒级文本与游标绑定精度不同。
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC).replace(tzinfo=None), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    target_type: Mapped[str | None] = mapped_column(String(64))
    target_id: Mapped[str | None] = mapped_column(String(64))
    expected_target_version: Mapped[int | None] = mapped_column(Integer)
    project_id: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=TaskStatus.queued)
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    progress: Mapped[int | None] = mapped_column(Integer)
    execution_mode: Mapped[str] = mapped_column(String(16), nullable=False, default=TaskExecutionMode.direct)
    worker_instance_id: Mapped[str | None] = mapped_column(String(64))
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    provider_id: Mapped[str | None] = mapped_column(ForeignKey("providers.id", ondelete="RESTRICT"))
    provider_task_id: Mapped[str | None] = mapped_column(String(255))
    remote_status: Mapped[str | None] = mapped_column(String(64))
    next_poll_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancel_reason: Mapped[str | None] = mapped_column(String(255))
    error_code: Mapped[str | None] = mapped_column(String(128))
    error_message: Mapped[str | None] = mapped_column(Text)
    last_poll_error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    retry_of_task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint("status IN ('queued','running','succeeded','failed','cancelled')", name="ck_tasks_status"),
        CheckConstraint("execution_mode IN ('direct','remote')", name="ck_tasks_execution_mode"),
        CheckConstraint("progress IS NULL OR (progress >= 0 AND progress <= 100)", name="ck_tasks_progress"),
        Index("ix_tasks_queue", "status", "created_at", "id"),
        Index("ix_tasks_poll", "status", "next_poll_at", "id"),
        Index("ix_tasks_deadline", "status", "deadline_at"),
        Index("ix_tasks_history", "created_at", "id"),
        Index("ix_tasks_project_history", "project_id", "created_at", "id"),
        Index("ix_tasks_target", "target_type", "target_id", "created_at"),
    )


class TaskInput(Base):
    """不可变参考文件及其输入位置，避免将文件版本复制到任务表。"""

    __tablename__ = "task_inputs"

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    role_path: Mapped[str] = mapped_column(String(255), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id", ondelete="RESTRICT"), nullable=False)

    __table_args__ = (Index("ix_task_inputs_file", "file_id", "task_id"),)


class TaskOutput(Base):
    """一个完整生成文件一行；输出身份是 task_id 与 ordinal。"""

    __tablename__ = "task_outputs"

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id", ondelete="RESTRICT"), nullable=False, index=True)
    delivery_status: Mapped[str | None] = mapped_column(String(16))
    delivery_reason: Mapped[str | None] = mapped_column(String(128))

    __table_args__ = (
        CheckConstraint("delivery_status IS NULL OR delivery_status IN ('published','conflicted','skipped')", name="ck_task_outputs_delivery"),
        CheckConstraint("ordinal >= 0", name="ck_task_outputs_ordinal"),
    )
