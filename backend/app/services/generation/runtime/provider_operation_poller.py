"""ProviderOperation 的单次轮询执行器。"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.contracts.provider_operation import ProviderOperationStatus
from app.models.provider_operations import ProviderOperation
from app.services.generation.runtime.provider_operation_driver import ProviderOperationDriver, ProviderPollResult
from app.services.generation.runtime.provider_operation_repository import ProviderOperationRepository


@dataclass(frozen=True, slots=True)
class ProviderPollExecution:
    """一次轮询的本地结果，供调用方决定是否把内存输出交给统一 Coordinator。"""

    operation_id: str
    result: ProviderPollResult


class ProviderOperationPoller:
    """执行一个已知远端 ID 的单次 poll，不直接写 Task、Attempt 或 Artifact 终态。"""

    def __init__(self, *, repository: ProviderOperationRepository) -> None:
        """注入短事务仓储，使 Driver 只处理 Provider I/O。"""
        self._repository = repository

    async def poll_once(
        self, *, operation: ProviderOperation, driver: ProviderOperationDriver, next_poll_delay_seconds: int = 15
    ) -> ProviderPollExecution | None:
        """轮询一个可恢复操作，并仅持久化其远端状态。

        ``None`` 表示本地状态已终态、缺 receipt 或 Driver 能力不匹配，调用方不得
        猜测重试 create。成功完成时的 ``output`` 只返回给当前进程，由主链的
        Coordinator 决定后续 DeliveryHandler 与 Task 终态。
        """
        if operation.status not in {
            ProviderOperationStatus.accepted.value,
            ProviderOperationStatus.polling.value,
            ProviderOperationStatus.cancel_requested_remote.value,
        }:
            return None
        receipt = await self._repository.get_remote_receipt(operation_id=operation.id)
        if receipt is None:
            await self._repository.mark_unknown(
                operation_id=operation.id,
                error_class="missing_remote_receipt",
                error_message="pollable provider operation has no controlled remote receipt",
            )
            return None
        if not driver.capabilities.supports_poll_by_handle:
            await self._repository.mark_unknown(
                operation_id=operation.id,
                error_class="poll_capability_unverified",
                error_message="provider driver does not verify poll-by-handle capability",
            )
            return None
        if not await self._repository.begin_polling(operation_id=operation.id):
            return None
        try:
            result = await driver.poll(remote_id=receipt.remote_id)
        except Exception as error:  # noqa: BLE001
            await self._repository.record_poll_error(
                operation_id=operation.id,
                error_class="poll_transport_error",
                error_message=f"{type(error).__name__}: {error}",
            )
            await self._repository.schedule_next_poll(
                operation_id=operation.id, delay_seconds=next_poll_delay_seconds
            )
            raise
        await self._persist_result(
            operation_id=operation.id,
            result=result,
            next_poll_delay_seconds=next_poll_delay_seconds,
        )
        return ProviderPollExecution(operation_id=operation.id, result=result)

    async def _persist_result(
        self, *, operation_id: str, result: ProviderPollResult, next_poll_delay_seconds: int
    ) -> None:
        """将 Driver 的中立 poll 结果映射为受保护的远端状态转换。"""
        if not result.terminal:
            await self._repository.schedule_next_poll(
                operation_id=operation_id, delay_seconds=next_poll_delay_seconds
            )
            return
        if result.cancelled:
            await self._repository.record_remote_cancelled(
                operation_id=operation_id, remote_status=result.remote_status
            )
            return
        if result.succeeded:
            await self._repository.record_remote_success(
                operation_id=operation_id, remote_status=result.remote_status
            )
            return
        await self._repository.record_remote_failure(
            operation_id=operation_id,
            remote_status=result.remote_status,
            error_code="provider_remote_failed",
            error_message="provider reported a terminal failure",
        )


__all__ = ["ProviderOperationPoller", "ProviderPollExecution"]
