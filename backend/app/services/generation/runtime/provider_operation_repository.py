"""ProviderOperation 的短事务持久化入口。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.provider_operation import ProviderOperationRemoteReceipt, ProviderOperationStatus
from app.models.provider_operations import ProviderOperation


class ProviderOperationRepository:
    """维护远端副作用状态，禁止将 Provider 字段重新写回 Attempt 控制面。"""

    def __init__(self, db: AsyncSession) -> None:
        """绑定一次短事务使用的数据库会话。"""
        self._db = db

    async def create_or_get(
        self,
        *,
        attempt_id: str,
        operation_kind: str,
        provider_key: str,
        model_id: str | None,
        route_identity: dict,
        capability_version: str | None,
        request_hash: str | None,
        idempotency_key: str | None,
    ) -> ProviderOperation:
        """按 Attempt/ordinal 幂等创建首个远端操作，不保存密钥或完整请求。"""
        existing = await self._db.scalar(
            select(ProviderOperation).where(ProviderOperation.attempt_id == attempt_id, ProviderOperation.ordinal == 1)
        )
        if existing is not None:
            return existing
        operation = ProviderOperation(
            id=uuid4().hex,
            attempt_id=attempt_id,
            ordinal=1,
            operation_kind=operation_kind,
            provider_key=provider_key,
            model_id=model_id,
            route_identity=route_identity,
            capability_version=capability_version,
            request_hash=request_hash,
            idempotency_key=idempotency_key,
            status=ProviderOperationStatus.not_started.value,
        )
        self._db.add(operation)
        await self._db.flush()
        return operation

    async def record_accepted(
        self, *, operation_id: str, remote_id: str
    ) -> bool:
        """仅从尚未受理状态写入明确远端 ID，拒绝覆盖已知 receipt。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        updated = await self._db.execute(
            update(ProviderOperation)
            .where(
                ProviderOperation.id == operation_id,
                ProviderOperation.status.in_((ProviderOperationStatus.not_started.value, ProviderOperationStatus.create_uncertain.value)),
                ProviderOperation.remote_id.is_(None),
            )
            .values(
                status=ProviderOperationStatus.accepted.value,
                remote_id=remote_id,
                remote_receipt=ProviderOperationRemoteReceipt(remote_id=remote_id).to_storage_value(),
                accepted_at=now,
                create_attempts=ProviderOperation.create_attempts + 1,
            )
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def get_remote_receipt(self, *, operation_id: str) -> ProviderOperationRemoteReceipt | None:
        """读取白名单 receipt，禁止 P3 或调用方接触 Provider 原始响应 JSON。"""
        operation = await self._db.scalar(
            select(ProviderOperation)
            .where(ProviderOperation.id == operation_id)
            .execution_options(populate_existing=True)
        )
        if operation is None:
            return None
        receipt = ProviderOperationRemoteReceipt.from_storage_value(operation.remote_receipt)
        if receipt is not None:
            return receipt
        if operation.remote_id:
            # receipt 列上线前的 checkpoint 仍只以受控字段形式向后续链路公开。
            return ProviderOperationRemoteReceipt(remote_id=operation.remote_id, remote_status=operation.remote_status)
        return None

    async def mark_create_uncertain(self, *, operation_id: str, error_class: str, error_message: str) -> bool:
        """记录无法判定 create 是否被远端受理的状态；reaper 不得据此重发。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        updated = await self._db.execute(
            update(ProviderOperation)
            .where(ProviderOperation.id == operation_id, ProviderOperation.status == ProviderOperationStatus.not_started.value)
            .values(
                status=ProviderOperationStatus.create_uncertain.value,
                create_uncertain_at=now,
                error_class=error_class,
                error_message=error_message,
                create_attempts=ProviderOperation.create_attempts + 1,
            )
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def record_remote_success(self, *, operation_id: str, remote_status: str | None) -> bool:
        """记录一次已确认的远端成功结果；本地 Task 仍由 Coordinator 唯一终态化。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        receipt = await self.get_remote_receipt(operation_id=operation_id)
        if receipt is None:
            return False
        updated = await self._db.execute(
            update(ProviderOperation)
            .where(
                ProviderOperation.id == operation_id,
                ProviderOperation.status.in_(
                    (
                        ProviderOperationStatus.accepted.value,
                        ProviderOperationStatus.polling.value,
                        ProviderOperationStatus.cancel_requested_remote.value,
                    )
                ),
            )
            .values(
                status=ProviderOperationStatus.succeeded_remote.value,
                remote_status=remote_status,
                remote_receipt=ProviderOperationRemoteReceipt(
                    remote_id=receipt.remote_id,
                    remote_status=remote_status,
                ).to_storage_value(),
                last_polled_at=now,
                finished_at=now,
                next_poll_at=None,
                poll_attempts=ProviderOperation.poll_attempts + 1,
            )
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def begin_polling(self, *, operation_id: str) -> bool:
        """登记一次轮询开始；异常后保留 polling 以便仅凭已知远端 ID 恢复。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        updated = await self._db.execute(
            update(ProviderOperation)
            .where(
                ProviderOperation.id == operation_id,
                ProviderOperation.status.in_(
                    (
                        ProviderOperationStatus.accepted.value,
                        ProviderOperationStatus.polling.value,
                        ProviderOperationStatus.cancel_requested_remote.value,
                    )
                ),
            )
            .values(status=ProviderOperationStatus.polling.value, last_polled_at=now)
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def record_poll_error(self, *, operation_id: str, error_class: str, error_message: str) -> bool:
        """保留可恢复 poll 的诊断，不把传输异常伪装成远端失败终态。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        updated = await self._db.execute(
            update(ProviderOperation)
            .where(ProviderOperation.id == operation_id, ProviderOperation.status == ProviderOperationStatus.polling.value)
            .values(last_polled_at=now, error_class=error_class, error_message=error_message)
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def record_remote_failure(
        self, *, operation_id: str, remote_status: str, error_code: str | None = None, error_message: str | None = None
    ) -> bool:
        """记录已确认的远端失败；本地 Task 是否失败仍由 Coordinator 唯一决定。"""
        return await self._record_terminal_poll_result(
            operation_id=operation_id,
            status=ProviderOperationStatus.failed_remote,
            remote_status=remote_status,
            error_code=error_code,
            error_message=error_message,
        )

    async def record_remote_cancelled(self, *, operation_id: str, remote_status: str) -> bool:
        """记录已确认的远端取消，避免把取消请求误记为远端已经终止。"""
        return await self._record_terminal_poll_result(
            operation_id=operation_id,
            status=ProviderOperationStatus.cancelled_remote,
            remote_status=remote_status,
            error_code=None,
            error_message=None,
        )

    async def request_remote_cancel(self, *, operation_id: str) -> bool:
        """持久化取消已请求但未确认的状态，供明确支持取消的 Driver 后续单次查询。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        updated = await self._db.execute(
            update(ProviderOperation)
            .where(
                ProviderOperation.id == operation_id,
                ProviderOperation.status.in_(
                    (ProviderOperationStatus.accepted.value, ProviderOperationStatus.polling.value)
                ),
            )
            .values(
                status=ProviderOperationStatus.cancel_requested_remote.value,
                cancel_requested_at=now,
                next_poll_at=now,
            )
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def mark_unknown(
        self, *, operation_id: str, error_class: str, error_message: str
    ) -> bool:
        """标记无法继续安全恢复的远端状态，禁止 Worker 据此盲目重发 create。"""
        updated = await self._db.execute(
            update(ProviderOperation)
            .where(
                ProviderOperation.id == operation_id,
                ProviderOperation.status.in_(
                    (
                        ProviderOperationStatus.create_uncertain.value,
                        ProviderOperationStatus.accepted.value,
                        ProviderOperationStatus.polling.value,
                        ProviderOperationStatus.cancel_requested_remote.value,
                    )
                ),
            )
            .values(
                status=ProviderOperationStatus.unknown.value,
                next_poll_at=None,
                error_class=error_class[:64],
                error_message=error_message[:4096],
            )
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def schedule_next_poll(self, *, operation_id: str, delay_seconds: int = 15) -> bool:
        """为尚未终态的远端操作登记下一次单次轮询，延迟必须为正数。"""
        if delay_seconds <= 0:
            raise ValueError("provider operation poll delay must be positive")
        now = datetime.now(UTC).replace(tzinfo=None)
        updated = await self._db.execute(
            update(ProviderOperation)
            .where(
                ProviderOperation.id == operation_id,
                ProviderOperation.status.in_(
                    (
                        ProviderOperationStatus.accepted.value,
                        ProviderOperationStatus.polling.value,
                        ProviderOperationStatus.cancel_requested_remote.value,
                    )
                ),
            )
            .values(next_poll_at=now + timedelta(seconds=delay_seconds))
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def _record_terminal_poll_result(
        self,
        *,
        operation_id: str,
        status: ProviderOperationStatus,
        remote_status: str,
        error_code: str | None,
        error_message: str | None,
    ) -> bool:
        """以受控 receipt 写入远端终态，避免不同 terminal 分支复制状态守卫。"""
        receipt = await self.get_remote_receipt(operation_id=operation_id)
        if receipt is None:
            return False
        now = datetime.now(UTC).replace(tzinfo=None)
        updated = await self._db.execute(
            update(ProviderOperation)
            .where(
                ProviderOperation.id == operation_id,
                ProviderOperation.status.in_(
                    (
                        ProviderOperationStatus.accepted.value,
                        ProviderOperationStatus.polling.value,
                        ProviderOperationStatus.cancel_requested_remote.value,
                    )
                ),
            )
            .values(
                status=status.value,
                remote_status=remote_status[:64],
                remote_receipt=ProviderOperationRemoteReceipt(
                    remote_id=receipt.remote_id,
                    remote_status=remote_status,
                ).to_storage_value(),
                last_polled_at=now,
                finished_at=now,
                next_poll_at=None,
                poll_attempts=ProviderOperation.poll_attempts + 1,
                error_code=error_code[:128] if error_code else None,
                error_message=error_message[:4096] if error_message else None,
            )
        )
        await self._db.flush()
        return bool(updated.rowcount)


__all__ = ["ProviderOperationRepository"]
