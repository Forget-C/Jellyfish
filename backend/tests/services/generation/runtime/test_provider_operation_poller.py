"""ProviderOperation 单次轮询状态机的回归测试。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.provider_capabilities import ProviderOperationCapabilities
from app.core.contracts.provider_operation import ProviderOperationStatus
from app.models.generation_runs import GenerationRun
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.services.generation.runtime.provider_operation_driver import ProviderPollResult
from app.services.generation.runtime.provider_operation_poller import ProviderOperationPoller
from app.services.generation.runtime.provider_operation_repository import ProviderOperationRepository
from app.core.db import Base


class _PollDriver:
    """测试用 Driver，只返回预设的单次 poll 结果。"""

    capabilities = ProviderOperationCapabilities(True, True)

    def __init__(self, result: ProviderPollResult) -> None:
        """保存当前测试要求的远端结果。"""
        self._result = result

    async def start_or_recover(self, *, remote_id: str | None):  # type: ignore[no-untyped-def]
        """本测试不覆盖 create。"""
        raise AssertionError("start_or_recover must not be called by poller")

    async def poll(self, *, remote_id: str) -> ProviderPollResult:
        """校验 poller 只使用受控 remote ID。"""
        assert remote_id == "remote-1"
        return self._result

    async def request_cancel(self, *, remote_id: str) -> bool:
        """本测试不覆盖远端取消请求。"""
        return False


async def _operation(tmp_path, filename: str):  # type: ignore[no-untyped-def]
    """创建包含已受理 ProviderOperation 的临时数据库。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / filename}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    db = factory()
    db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="video_generation", status=GenerationTaskStatus.running, payload={}))
    db.add(GenerationRun(id="attempt-1", task_id="task-1", attempt_no=1, status="executing"))
    await db.flush()
    repository = ProviderOperationRepository(db)
    operation = await repository.create_or_get(attempt_id="attempt-1", operation_kind="video_generation", provider_key="vidu", model_id="model-1", route_identity={}, capability_version="v1", request_hash=None, idempotency_key=None)
    assert await repository.record_accepted(operation_id=operation.id, remote_id="remote-1")
    return engine, db, repository, operation


@pytest.mark.asyncio
async def test_single_poll_records_remote_terminal_states_without_writing_task(tmp_path) -> None:
    """成功、失败、取消均只写 ProviderOperation，Task 仍保持运行态等待 Coordinator。"""
    cases = [
        (ProviderPollResult(remote_status="done", terminal=True, succeeded=True), ProviderOperationStatus.succeeded_remote),
        (ProviderPollResult(remote_status="failed", terminal=True, succeeded=False), ProviderOperationStatus.failed_remote),
        (ProviderPollResult(remote_status="cancelled", terminal=True, succeeded=False, cancelled=True), ProviderOperationStatus.cancelled_remote),
    ]
    for index, (result, expected) in enumerate(cases):
        engine, db, repository, operation = await _operation(tmp_path, f"poll-{index}.db")
        try:
            execution = await ProviderOperationPoller(repository=repository).poll_once(
                operation=operation, driver=_PollDriver(result)
            )
            assert execution is not None
            await db.refresh(operation)
            task = await db.get(GenerationTask, "task-1")
            assert operation.status == expected.value
            assert task is not None and task.status == GenerationTaskStatus.running
        finally:
            await db.close()
            await engine.dispose()


@pytest.mark.asyncio
async def test_single_nonterminal_poll_schedules_recovery(tmp_path) -> None:
    """非终态 poll 只登记下一次轮询，不把运行中的远端操作误判为失败。"""
    engine, db, repository, operation = await _operation(tmp_path, "poll-running.db")
    try:
        execution = await ProviderOperationPoller(repository=repository).poll_once(
            operation=operation,
            driver=_PollDriver(ProviderPollResult(remote_status="running", terminal=False, succeeded=False)),
            next_poll_delay_seconds=1,
        )
        assert execution is not None
        await db.refresh(operation)
        assert operation.status == ProviderOperationStatus.polling.value
        assert operation.next_poll_at is not None
    finally:
        await db.close()
        await engine.dispose()
