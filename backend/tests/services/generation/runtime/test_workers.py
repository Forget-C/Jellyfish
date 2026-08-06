"""无状态 GenerationWorker 的命令输入与 callback 输出测试。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.contracts.generation import (
    GenerationOperation,
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.generation_run import GenerationWorkerCallbackKind, GenerationWorkerCommand
from app.core.contracts.image_generation import ImageGenerationResult, ImageItem
from app.services.generation.runtime import workers


class _SessionContext:
    """不带持久化能力的 Worker 会话替身，确保测试不依赖 TaskStore。"""

    def __init__(self, provider_task_id: str | None = None) -> None:
        """配置 Worker 所见的已持久化供应商任务 ID。"""
        self._provider_task_id = provider_task_id

    async def __aenter__(self) -> object:
        """返回纯对象，Provider 适配函数只验证其被传递。"""
        return _WorkerDb(provider_task_id=self._provider_task_id)

    async def __aexit__(self, *_args: object) -> None:
        """结束无副作用的测试会话。"""


class _WorkerDb:
    """最小 Run 读取替身，默认模拟尚未持久化供应商任务 ID。"""

    def __init__(self, *, provider_task_id: str | None) -> None:
        """保存模拟 Run 的恢复检查点。"""
        self._provider_task_id = provider_task_id

    async def get(self, _model: object, _run_id: str) -> SimpleNamespace:
        """返回当前 Run 的恢复检查点。"""
        return SimpleNamespace(provider_task_id=self._provider_task_id)

    async def commit(self) -> None:
        """模拟 ProviderOperation checkpoint 在调用远端前的短事务提交。"""


class _ProviderOperationRepository:
    """隔离 Worker 单测中的 ProviderOperation 短事务实现。"""

    def __init__(self, _db: object) -> None:
        """接收 Worker 传入的会话替身。"""

    async def record_remote_success(self, **_kwargs: object) -> bool:
        """模拟已记录远端成功，不接管本地 Task 终态。"""
        return True

    async def begin_polling(self, **_kwargs: object) -> bool:
        """模拟已知远端 ID 的恢复轮询登记。"""
        return True


def _command() -> GenerationWorkerCommand:
    """构造图片 Worker 的最小 fencing 命令。"""

    return GenerationWorkerCommand(
        run_id="run-1",
        task_id="task-1",
        lease_epoch=1,
        lease_owner="worker-1",
        lease_ttl_seconds=30,
        provider_idempotency_key="generation-run:run-1",
        operation=GenerationOperation.image_generation,
        snapshot=ResolvedGenerationSnapshot(
            model_id="model-1",
            canonical_target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id="session-1"),
            operation_input=ImageGenerationOperationInput(),
            execution_prompt="一只水母",
        ),
    )


@pytest.mark.asyncio
async def test_worker_returns_provider_result_only_in_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    """成功 Worker 只返回 callback 与结果，不接触 Task 或 Artifact 持久化层。"""

    async def _execute(_db: object, *, task_id: str, snapshot: ResolvedGenerationSnapshot, **_kwargs: object) -> ImageGenerationResult:
        assert task_id == "task-1"
        assert snapshot.execution_prompt == "一只水母"
        return ImageGenerationResult(
            provider="openai",
            provider_task_id="provider-1",
            status="succeeded",
            images=[ImageItem(url="https://provider.test/image.png")],
        )

    monkeypatch.setattr(workers, "async_session_maker", _SessionContext)
    monkeypatch.setattr(workers, "ProviderOperationRepository", _ProviderOperationRepository)
    monkeypatch.setattr(workers, "_resolve_provider_operation_remote_id", lambda **_kwargs: _operation_checkpoint())
    monkeypatch.setattr(workers, "execute_snapshot_image_generation", _execute)

    execution = await workers.execute_worker_command(_command())

    assert execution.callback.kind is GenerationWorkerCallbackKind.succeeded
    assert execution.callback.provider_task_id == "provider-1"
    assert execution.provider_result is not None


@pytest.mark.asyncio
async def test_worker_converts_provider_exception_to_failed_callback(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provider 异常只能变为失败 callback，不能由 Worker 直写任务终态。"""

    async def _raise(_db: object, **_kwargs: object) -> ImageGenerationResult:
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(workers, "async_session_maker", _SessionContext)
    monkeypatch.setattr(workers, "ProviderOperationRepository", _ProviderOperationRepository)
    monkeypatch.setattr(workers, "_resolve_provider_operation_remote_id", lambda **_kwargs: _operation_checkpoint())
    monkeypatch.setattr(workers, "execute_snapshot_image_generation", _raise)

    execution = await workers.execute_worker_command(_command())

    assert execution.callback.kind is GenerationWorkerCallbackKind.failed
    assert execution.callback.error_code == "generation_worker_failed"
    assert execution.provider_result is None


@pytest.mark.asyncio
async def test_worker_reuses_persisted_provider_task_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """恢复 Worker 必须把已持久化的 provider_task_id 交给轮询路径，而非再次创建。"""

    async def _execute(_db: object, **kwargs: object) -> ImageGenerationResult:
        assert kwargs["provider_task_id"] == "provider-existing"
        return ImageGenerationResult(
            provider="vidu",
            provider_task_id="provider-existing",
            status="succeeded",
            images=[ImageItem(url="https://provider.test/recovered.png")],
        )

    monkeypatch.setattr(workers, "async_session_maker", lambda: _SessionContext("provider-existing"))
    monkeypatch.setattr(workers, "ProviderOperationRepository", _ProviderOperationRepository)
    monkeypatch.setattr(workers, "_resolve_provider_operation_remote_id", lambda **_kwargs: _operation_checkpoint("provider-existing"))
    monkeypatch.setattr(workers, "execute_snapshot_image_generation", _execute)

    execution = await workers.execute_worker_command(_command())

    assert execution.callback.provider_task_id == "provider-existing"


async def _operation_checkpoint(remote_id: str | None = None) -> tuple[str, str | None]:
    """提供不访问真实 Provider 配置的 Operation checkpoint 替身。"""
    return "operation-1", remote_id


def test_provider_operation_route_identity_excludes_url_secrets() -> None:
    """ProviderOperation 不能持久化 URL 中可能存在的凭据和临时 query。"""
    assert workers._safe_route_identity("https://key:secret@provider.test/v1/images?token=hidden#fragment") == {
        "scheme": "https",
        "host": "provider.test",
        "path": "/v1/images",
    }
