"""MediaBlob 与 StorageOperationOutbox 的 expand 阶段仓储。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.storage_operation import MediaBlobStatus, StorageOperationKind, StorageOperationStatus
from app.models.media_blobs import MediaBlob, StorageOperationOutbox

_FORBIDDEN_PAYLOAD_KEYS = frozenset({"url", "uri", "authorization", "api_key", "token", "secret", "cookie"})


@dataclass(frozen=True)
class StorageOperationLease:
    """已被单个 Worker 围栏领取的存储操作及目标 Blob 身份。"""

    operation_id: str
    blob_id: str
    storage_key: str
    content_type: str
    operation_kind: StorageOperationKind
    payload: dict[str, Any]
    owner: str
    epoch: int


class StorageOperationOutboxRepository:
    """仅持久化稳定对象身份与操作意图，禁止在 outbox 中存临时 URL 或凭据。"""

    def __init__(self, db: AsyncSession) -> None:
        """绑定本次调用的短事务数据库会话。"""
        self._db = db

    async def create_pending_blob(
        self,
        *,
        storage_key: str,
        content_type: str,
        retention_until: datetime | None = None,
    ) -> MediaBlob:
        """按稳定存储 key 幂等登记待物化 Blob，不执行任何外部 I/O。"""
        existing = await self._db.scalar(select(MediaBlob).where(MediaBlob.storage_key == storage_key))
        if existing is not None:
            return existing
        blob = MediaBlob(
            id=uuid4().hex,
            storage_key=storage_key,
            content_type=content_type,
            status=MediaBlobStatus.pending_materialization.value,
            retention_until=retention_until,
        )
        self._db.add(blob)
        await self._db.flush()
        return blob

    async def create_materialized_blob(
        self,
        *,
        storage_key: str,
        content_type: str,
    ) -> MediaBlob:
        """为已存在的受控对象登记 Blob；仅用于将旧文件删除纳入可靠 outbox。"""
        existing = await self._db.scalar(select(MediaBlob).where(MediaBlob.storage_key == storage_key))
        if existing is not None:
            return existing
        blob = MediaBlob(
            id=uuid4().hex,
            storage_key=storage_key,
            content_type=content_type,
            status=MediaBlobStatus.materialized.value,
            materialized_at=datetime.now(UTC).replace(tzinfo=None),
        )
        self._db.add(blob)
        await self._db.flush()
        return blob

    async def enqueue(
        self,
        *,
        blob_id: str,
        operation_kind: StorageOperationKind,
        idempotency_key: str,
        payload: dict[str, Any],
        not_before_at: datetime | None = None,
    ) -> StorageOperationOutbox:
        """按幂等键创建存储意图，并拒绝任何可能泄漏的 URL 或凭据字段。"""
        _ensure_safe_payload(payload)
        if operation_kind is StorageOperationKind.materialize:
            _ensure_materialize_source_payload(payload)
        existing = await self._db.scalar(
            select(StorageOperationOutbox).where(StorageOperationOutbox.idempotency_key == idempotency_key)
        )
        if existing is not None:
            return existing
        outbox = StorageOperationOutbox(
            id=uuid4().hex,
            blob_id=blob_id,
            operation_kind=operation_kind.value,
            status=StorageOperationStatus.pending.value,
            idempotency_key=idempotency_key,
            payload=payload,
            not_before_at=not_before_at,
        )
        self._db.add(outbox)
        await self._db.flush()
        return outbox

    async def claim_next_materialize(self, *, owner: str, ttl_seconds: int) -> StorageOperationLease | None:
        """原子领取一条到期可恢复的 materialize 意图，返回 fencing lease。

        外部 I/O 一律发生在此方法返回之后；旧 Worker 即使迟到，也无法用旧
        lease 更新 Blob 或 outbox。
        """
        return await self.claim_next(operation_kind=StorageOperationKind.materialize, owner=owner, ttl_seconds=ttl_seconds)

    async def claim_next(
        self,
        *,
        operation_kind: StorageOperationKind,
        owner: str,
        ttl_seconds: int,
    ) -> StorageOperationLease | None:
        """原子领取指定类别的存储意图；外部 I/O 必须发生在此方法返回之后。"""
        if ttl_seconds <= 0:
            raise ValueError("storage operation lease ttl_seconds must be positive")
        now = datetime.now(UTC).replace(tzinfo=None)
        candidate = await self._db.scalar(
            select(StorageOperationOutbox.id)
            .where(
                StorageOperationOutbox.operation_kind == operation_kind.value,
                StorageOperationOutbox.not_before_at.is_(None) | (StorageOperationOutbox.not_before_at <= now),
                or_(
                    StorageOperationOutbox.status == StorageOperationStatus.pending.value,
                    and_(
                        StorageOperationOutbox.status == StorageOperationStatus.leased.value,
                        StorageOperationOutbox.lease_expires_at.is_not(None),
                        StorageOperationOutbox.lease_expires_at <= now,
                    ),
                ),
            )
            .order_by(StorageOperationOutbox.created_at, StorageOperationOutbox.id)
            .limit(1)
        )
        if candidate is None:
            return None
        claimed = await self._db.execute(
            update(StorageOperationOutbox)
            .where(
                StorageOperationOutbox.id == candidate,
                StorageOperationOutbox.operation_kind == operation_kind.value,
                StorageOperationOutbox.not_before_at.is_(None) | (StorageOperationOutbox.not_before_at <= now),
                or_(
                    StorageOperationOutbox.status == StorageOperationStatus.pending.value,
                    and_(
                        StorageOperationOutbox.status == StorageOperationStatus.leased.value,
                        StorageOperationOutbox.lease_expires_at.is_not(None),
                        StorageOperationOutbox.lease_expires_at <= now,
                    ),
                ),
            )
            .values(
                status=StorageOperationStatus.leased.value,
                lease_owner=owner,
                lease_epoch=StorageOperationOutbox.lease_epoch + 1,
                lease_expires_at=now + timedelta(seconds=ttl_seconds),
                attempts=StorageOperationOutbox.attempts + 1,
            )
            .returning(StorageOperationOutbox.id, StorageOperationOutbox.blob_id, StorageOperationOutbox.payload, StorageOperationOutbox.lease_epoch)
        )
        row = claimed.one_or_none()
        if row is None:
            return None
        blob = await self._db.get(MediaBlob, row.blob_id)
        if blob is None:
            raise RuntimeError(f"storage outbox references missing blob: {row.blob_id}")
        await self._db.flush()
        return StorageOperationLease(
            operation_id=row.id,
            blob_id=row.blob_id,
            storage_key=blob.storage_key,
            content_type=blob.content_type,
            operation_kind=operation_kind,
            payload=dict(row.payload),
            owner=owner,
            epoch=row.lease_epoch,
        )

    async def complete_materialization(
        self,
        *,
        lease: StorageOperationLease,
        size_bytes: int | None,
        content_type: str | None,
        etag: str | None,
    ) -> bool:
        """以 lease fencing 绑定 HEAD 元数据，并完成对应 outbox 操作。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        outbox_updated = await self._db.execute(
            update(StorageOperationOutbox)
            .where(
                StorageOperationOutbox.id == lease.operation_id,
                StorageOperationOutbox.status == StorageOperationStatus.leased.value,
                StorageOperationOutbox.lease_owner == lease.owner,
                StorageOperationOutbox.lease_epoch == lease.epoch,
                StorageOperationOutbox.lease_expires_at > now,
            )
            .values(
                status=StorageOperationStatus.completed.value,
                lease_owner=None,
                lease_expires_at=None,
                completed_at=now,
                last_error_code=None,
                last_error=None,
            )
        )
        if not outbox_updated.rowcount:
            await self._db.flush()
            return False
        blob_updated = await self._db.execute(
            update(MediaBlob)
            .where(MediaBlob.id == lease.blob_id)
            .values(
                status=MediaBlobStatus.materialized.value,
                size_bytes=size_bytes,
                content_type=content_type or lease.content_type,
                etag=etag,
                materialized_at=now,
                error_code=None,
                error_message=None,
            )
        )
        await self._db.flush()
        return bool(blob_updated.rowcount)

    async def request_delete(self, *, blob_id: str, idempotency_key: str) -> StorageOperationOutbox:
        """写入 Blob 删除墓碑和 delete outbox；对象存储删除留给独立 Worker。"""
        blob = await self._db.get(MediaBlob, blob_id, with_for_update=True)
        if blob is None:
            raise LookupError(f"media blob not found: {blob_id}")
        if blob.status == MediaBlobStatus.deleted.value:
            raise ValueError(f"media blob is already deleted: {blob_id}")
        if blob.status != MediaBlobStatus.delete_pending.value:
            blob.status = MediaBlobStatus.delete_pending.value
            blob.delete_tombstoned_at = datetime.now(UTC).replace(tzinfo=None)
        return await self.enqueue(
            blob_id=blob.id,
            operation_kind=StorageOperationKind.delete,
            idempotency_key=idempotency_key,
            payload={},
        )

    async def complete_deletion(self, *, lease: StorageOperationLease) -> bool:
        """以 fencing lease 记录对象已物理删除，避免失败时虚报删除成功。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        outbox_updated = await self._db.execute(
            update(StorageOperationOutbox)
            .where(
                StorageOperationOutbox.id == lease.operation_id,
                StorageOperationOutbox.status == StorageOperationStatus.leased.value,
                StorageOperationOutbox.lease_owner == lease.owner,
                StorageOperationOutbox.lease_epoch == lease.epoch,
                StorageOperationOutbox.lease_expires_at > now,
            )
            .values(
                status=StorageOperationStatus.completed.value,
                lease_owner=None,
                lease_expires_at=None,
                completed_at=now,
                last_error_code=None,
                last_error=None,
            )
        )
        if not outbox_updated.rowcount:
            await self._db.flush()
            return False
        blob_updated = await self._db.execute(
            update(MediaBlob)
            .where(MediaBlob.id == lease.blob_id, MediaBlob.status == MediaBlobStatus.delete_pending.value)
            .values(status=MediaBlobStatus.deleted.value, deleted_at=now, error_code=None, error_message=None)
        )
        await self._db.flush()
        return bool(blob_updated.rowcount)

    async def release_for_retry(self, *, lease: StorageOperationLease, error_code: str, error: str) -> bool:
        """记录可恢复失败并释放 lease；下一次调度可安全重新物化固定 key。"""
        updated = await self._db.execute(
            update(StorageOperationOutbox)
            .where(
                StorageOperationOutbox.id == lease.operation_id,
                StorageOperationOutbox.status == StorageOperationStatus.leased.value,
                StorageOperationOutbox.lease_owner == lease.owner,
                StorageOperationOutbox.lease_epoch == lease.epoch,
            )
            .values(
                status=StorageOperationStatus.pending.value,
                lease_owner=None,
                lease_expires_at=None,
                last_error_code=error_code[:128],
                last_error=error[:4096],
            )
        )
        await self._db.flush()
        return bool(updated.rowcount)


def _ensure_safe_payload(value: object, *, path: str = "payload") -> None:
    """递归拒绝 URL、凭据与可疑字段；来源由后续 Worker 按受控 ID 解析。"""
    if isinstance(value, dict):
        for key, nested in value.items():
            if key.casefold() in _FORBIDDEN_PAYLOAD_KEYS:
                raise ValueError(f"storage outbox payload must not contain sensitive field: {path}.{key}")
            _ensure_safe_payload(nested, path=f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _ensure_safe_payload(nested, path=f"{path}[{index}]")
    elif isinstance(value, str) and "://" in value:
        raise ValueError(f"storage outbox payload must not contain URL value: {path}")


def _ensure_materialize_source_payload(payload: dict[str, Any]) -> None:
    """将媒体物化意图收敛为唯一可跨进程读取的 ProviderOperation 身份。

    materialize Worker 不应依赖 Artifact、Provider 原始响应或临时下载地址；这些
    数据要么会产生跨层耦合，要么无法安全地在重试时使用。具体字节来源由 Worker
    根据该 ID 读取白名单 receipt 后，在运行期交给 Provider adapter 重新解析。
    """
    if set(payload) != {"provider_operation_id"}:
        raise ValueError("materialize payload must contain only provider_operation_id")
    provider_operation_id = payload["provider_operation_id"]
    if not isinstance(provider_operation_id, str) or not provider_operation_id.strip():
        raise ValueError("materialize payload provider_operation_id must be a non-empty string")


__all__ = ["StorageOperationLease", "StorageOperationOutboxRepository"]
