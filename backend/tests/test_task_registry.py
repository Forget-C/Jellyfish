from __future__ import annotations

import pytest

from app.core.task_manager.types import BaseTask
from app.core.tasks.bootstrap import bootstrap_task_adapters
from app.core.tasks.image_generation_tasks import ImageGenerationTask
from app.core.tasks.registry import register_task_adapter, resolve_task_adapter
from app.core.tasks.video_generation_tasks import VideoGenerationTask


class _DummyTask(BaseTask):
    async def run(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None

    async def status(self):
        return {}

    async def is_done(self) -> bool:
        return True

    async def get_result(self):
        return None


class _AnotherDummyTask(BaseTask):
    async def run(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None

    async def status(self):
        return {}

    async def is_done(self) -> bool:
        return True

    async def get_result(self):
        return None


def _factory_a(**kwargs) -> BaseTask:  # noqa: ANN003
    return _DummyTask()


def _factory_b(**kwargs) -> BaseTask:  # noqa: ANN003
    return _AnotherDummyTask()


def test_register_task_adapter_is_idempotent_for_same_factory() -> None:
    register_task_adapter("unit_test_kind", "unit_test_provider", _factory_a)
    register_task_adapter("unit_test_kind", "unit_test_provider", _factory_a)

    resolved = resolve_task_adapter("unit_test_kind", "unit_test_provider")
    assert resolved is _factory_a


def test_register_task_adapter_rejects_conflict_factory() -> None:
    register_task_adapter("unit_test_kind_conflict", "unit_test_provider", _factory_a)
    with pytest.raises(ValueError) as exc_info:
        register_task_adapter("unit_test_kind_conflict", "unit_test_provider", _factory_b)
    assert "task adapter conflict" in str(exc_info.value)


def test_resolve_task_adapter_raises_for_unknown_key() -> None:
    with pytest.raises(ValueError) as exc_info:
        resolve_task_adapter("not_registered_kind", "not_registered_provider")
    assert "Unsupported provider/task adapter" in str(exc_info.value)


def test_bootstrap_registers_dreamapi_image_and_video_tasks() -> None:
    bootstrap_task_adapters()

    assert resolve_task_adapter("image_generation", "dreamapi") is ImageGenerationTask._build_dreamapi_impl
    assert resolve_task_adapter("video_generation", "dreamapi") is VideoGenerationTask._build_dreamapi_impl
