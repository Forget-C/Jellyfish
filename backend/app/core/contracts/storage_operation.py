"""媒体 Blob 与存储 outbox 的中立持久化契约。"""

from __future__ import annotations

from enum import Enum


class MediaBlobStatus(str, Enum):
    """受控媒体对象的物理存储生命周期，独立于 Artifact 发布状态。"""

    pending_materialization = "pending_materialization"
    materialized = "materialized"
    verification_failed = "verification_failed"
    delete_pending = "delete_pending"
    deleted = "deleted"


class StorageOperationKind(str, Enum):
    """存储 Worker 可以执行的外部 I/O 意图。"""

    materialize = "materialize"
    verify = "verify"
    delete = "delete"


class StorageOperationStatus(str, Enum):
    """StorageOperationOutbox 的可重试投递状态。"""

    pending = "pending"
    leased = "leased"
    completed = "completed"
    failed = "failed"


__all__ = [
    "MediaBlobStatus",
    "StorageOperationKind",
    "StorageOperationStatus",
]
