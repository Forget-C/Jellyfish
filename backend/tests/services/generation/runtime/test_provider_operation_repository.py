"""ProviderOperation expand 存储的最小回归测试。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.generation_runs import GenerationRun
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.services.generation.runtime.provider_operation_repository import ProviderOperationRepository


@pytest.mark.asyncio
async def test_provider_operation_records_accepted_and_preserves_remote_id(tmp_path) -> None:
    """同一 Attempt 只有一个首操作，已确认远端 ID 不能被后续写入覆盖。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'provider-operation.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="video_generation", status=GenerationTaskStatus.running, payload={}))
        db.add(GenerationRun(id="attempt-1", task_id="task-1", attempt_no=1, status="executing"))
        await db.flush()
        repository = ProviderOperationRepository(db)
        operation = await repository.create_or_get(attempt_id="attempt-1", operation_kind="video_generation", provider_key="vidu", model_id="model-1", route_identity={"base_url": "https://provider.test"}, capability_version="v1", request_hash="hash", idempotency_key="key")
        assert (await repository.create_or_get(attempt_id="attempt-1", operation_kind="video_generation", provider_key="vidu", model_id="model-1", route_identity={}, capability_version=None, request_hash=None, idempotency_key=None)).id == operation.id
        assert await repository.record_accepted(operation_id=operation.id, remote_id="remote-1")
        assert not await repository.record_accepted(operation_id=operation.id, remote_id="remote-2")
        await db.refresh(operation)
        assert (operation.status, operation.remote_id, operation.create_attempts) == ("accepted", "remote-1", 1)
        assert operation.remote_receipt == {"remote_id": "remote-1"}
        receipt = await repository.get_remote_receipt(operation_id=operation.id)
        assert receipt is not None
        assert (receipt.remote_id, receipt.remote_status) == ("remote-1", None)
    await engine.dispose()


@pytest.mark.asyncio
async def test_provider_operation_marks_uncertain_create_without_remote_id(tmp_path) -> None:
    """create 结果未知必须单独记录，不能伪造 accepted 或远端 ID。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'provider-uncertain.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="video_generation", status=GenerationTaskStatus.running, payload={}))
        db.add(GenerationRun(id="attempt-1", task_id="task-1", attempt_no=1, status="executing"))
        await db.flush()
        repository = ProviderOperationRepository(db)
        operation = await repository.create_or_get(attempt_id="attempt-1", operation_kind="video_generation", provider_key="vidu", model_id="model-1", route_identity={}, capability_version="v1", request_hash=None, idempotency_key=None)
        assert await repository.mark_create_uncertain(operation_id=operation.id, error_class="transport_timeout", error_message="timed out")
        await db.refresh(operation)
        assert (operation.status, operation.remote_id, operation.error_class, operation.create_attempts) == ("create_uncertain", None, "transport_timeout", 1)
    await engine.dispose()


@pytest.mark.asyncio
async def test_provider_operation_records_remote_success_without_task_terminal_write(tmp_path) -> None:
    """远端成功只更新 ProviderOperation，Task 终态仍由后续 Coordinator 裁决。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'provider-success.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        task = GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="video_generation", status=GenerationTaskStatus.running, payload={})
        db.add(task)
        db.add(GenerationRun(id="attempt-1", task_id="task-1", attempt_no=1, status="executing"))
        await db.flush()
        repository = ProviderOperationRepository(db)
        operation = await repository.create_or_get(attempt_id="attempt-1", operation_kind="video_generation", provider_key="vidu", model_id="model-1", route_identity={}, capability_version="v1", request_hash=None, idempotency_key=None)
        assert await repository.record_accepted(operation_id=operation.id, remote_id="remote-1")
        assert await repository.record_remote_success(operation_id=operation.id, remote_status="succeeded")
        await db.refresh(operation)
        await db.refresh(task)
        assert (operation.status, operation.remote_status, operation.poll_attempts) == ("succeeded_remote", "succeeded", 1)
        assert operation.remote_receipt == {"remote_id": "remote-1", "remote_status": "succeeded"}
        assert task.status == GenerationTaskStatus.running
    await engine.dispose()


@pytest.mark.asyncio
async def test_provider_operation_marks_known_remote_work_as_polling(tmp_path) -> None:
    """只有已有 remote_id 的 Operation 才能进入可恢复 polling 状态。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'provider-polling.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="video_generation", status=GenerationTaskStatus.running, payload={}))
        db.add(GenerationRun(id="attempt-1", task_id="task-1", attempt_no=1, status="executing"))
        await db.flush()
        repository = ProviderOperationRepository(db)
        operation = await repository.create_or_get(attempt_id="attempt-1", operation_kind="video_generation", provider_key="vidu", model_id="model-1", route_identity={}, capability_version="v1", request_hash=None, idempotency_key=None)
        assert not await repository.begin_polling(operation_id=operation.id)
        assert await repository.record_accepted(operation_id=operation.id, remote_id="remote-1")
        assert await repository.begin_polling(operation_id=operation.id)
        await db.refresh(operation)
        assert operation.status == "polling"
        assert operation.last_polled_at is not None
    await engine.dispose()


@pytest.mark.asyncio
async def test_provider_operation_keeps_polling_when_poll_error_is_uncertain(tmp_path) -> None:
    """传输错误不应伪装为远端失败，保留已知 receipt 供后续恢复。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'provider-poll-error.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="video_generation", status=GenerationTaskStatus.running, payload={}))
        db.add(GenerationRun(id="attempt-1", task_id="task-1", attempt_no=1, status="executing"))
        await db.flush()
        repository = ProviderOperationRepository(db)
        operation = await repository.create_or_get(attempt_id="attempt-1", operation_kind="video_generation", provider_key="vidu", model_id="model-1", route_identity={}, capability_version="v1", request_hash=None, idempotency_key=None)
        assert await repository.record_accepted(operation_id=operation.id, remote_id="remote-1")
        assert await repository.begin_polling(operation_id=operation.id)
        assert await repository.record_poll_error(operation_id=operation.id, error_class="transport_timeout", error_message="timed out")
        await db.refresh(operation)
        assert (operation.status, operation.remote_id, operation.error_class) == ("polling", "remote-1", "transport_timeout")
        receipt = await repository.get_remote_receipt(operation_id=operation.id)
        assert receipt is not None
        assert receipt.remote_id == "remote-1"
        assert receipt.remote_status is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_provider_operation_remote_receipt_rejects_raw_provider_response(tmp_path) -> None:
    """受控读取只返回 remote ID/status，不能将 URL 或凭据样字段传播给 P3。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'provider-receipt.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="video_generation", status=GenerationTaskStatus.running, payload={}))
        db.add(GenerationRun(id="attempt-1", task_id="task-1", attempt_no=1, status="executing"))
        await db.flush()
        repository = ProviderOperationRepository(db)
        operation = await repository.create_or_get(attempt_id="attempt-1", operation_kind="video_generation", provider_key="vidu", model_id="model-1", route_identity={}, capability_version="v1", request_hash=None, idempotency_key=None)
        operation.remote_receipt = {"remote_id": "remote-1", "download_url": "https://user:secret@example.test/a?token=nope", "api_key": "nope"}
        await db.flush()
        receipt = await repository.get_remote_receipt(operation_id=operation.id)
        assert receipt is not None
        assert receipt.to_storage_value() == {"remote_id": "remote-1"}
    await engine.dispose()
