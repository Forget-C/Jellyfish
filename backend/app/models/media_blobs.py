"""媒体 Blob 及其外部存储操作 outbox 持久化模型。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin


class MediaBlob(Base, TimestampMixin):
    """受控对象存储中的稳定媒体对象，不保存 Provider 临时下载地址。"""

    __tablename__ = "media_blobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # MySQL utf8mb4 的唯一索引上限为 3072 bytes；700 字符为稳定对象 key 留出余量。
    storage_key: Mapped[str] = mapped_column(String(700), nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    etag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delete_tombstoned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    materialized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_media_blobs_status_retention", "status", "retention_until"),
    )


class StorageOperationOutbox(Base, TimestampMixin):
    """以短事务创建的存储 I/O 意图，Worker 使用 lease 与幂等键安全重试。"""

    __tablename__ = "storage_operation_outbox"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    blob_id: Mapped[str] = mapped_column(ForeignKey("media_blobs.id", ondelete="RESTRICT"), nullable=False, index=True)
    operation_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lease_owner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lease_epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    not_before_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("blob_id", "operation_kind", "idempotency_key", name="uq_storage_outbox_blob_operation_key"),
        Index("ix_storage_outbox_status_not_before", "status", "not_before_at", "created_at"),
        Index("ix_storage_outbox_status_lease", "status", "lease_expires_at"),
    )


__all__ = ["MediaBlob", "StorageOperationOutbox"]
