"""ProviderOperation 的持久化模型。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin


class ProviderOperation(Base, TimestampMixin):
    """记录一次 Attempt 对远端 Provider 的可恢复副作用及其非敏感冻结身份。

    本表不保存 API key、完整提示词或媒体字节。首个 expand 切片仅建立存储，
    现有 ``GenerationRun.provider_task_id`` 继续作为 dual-read 兼容来源。
    """

    __tablename__ = "provider_operations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempt_id: Mapped[str] = mapped_column(
        ForeignKey("generation_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    operation_kind: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_key: Mapped[str] = mapped_column(String(64), nullable=False)
    model_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    route_identity: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    capability_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    secret_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    request_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    remote_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    remote_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    remote_receipt: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    create_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    poll_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_poll_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    create_uncertain_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_class: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("attempt_id", "ordinal", name="uq_provider_operations_attempt_ordinal"),
        Index("ix_provider_operations_status_next_poll", "status", "next_poll_at"),
        Index("ix_provider_operations_provider_remote", "provider_key", "remote_id"),
    )


__all__ = ["ProviderOperation"]
