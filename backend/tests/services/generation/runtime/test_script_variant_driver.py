"""剧本变体 Attempt Driver / DeliveryHandler 的纯执行边界测试。"""

from __future__ import annotations

from app.core.contracts.execution_attempt import ExecutionAttemptLease
from app.schemas.skills.script_processing import VariantAnalysisResult
from app.services.execution_attempt_runtime import DeliveryContext, TaskExecutionCommand
from app.services.generation.runtime.script_variant_driver import (
    ScriptVariantDeliveryHandler,
    ScriptVariantTaskExecutionDriver,
)


def _command(*, task_kind: str = "script_variant", snapshot: dict[str, object] | None = None) -> TaskExecutionCommand:
    """构造不依赖持久化状态的变体分析 Attempt 命令。"""
    return TaskExecutionCommand(
        lease=ExecutionAttemptLease(
            attempt_id="attempt-1",
            task_id="task-1",
            lease_epoch=2,
            lease_owner="worker-1",
            lease_ttl_seconds=30,
        ),
        task_kind=task_kind,
        snapshot=snapshot
        or {
            "run_args": {
                "merged_library": {"characters": []},
                "all_shot_extractions": [],
                "script_division": {},
            }
        },
        cancel_requested=False,
    )


async def test_script_variant_driver_executes_frozen_input_without_task_writes() -> None:
    """Driver 仅调用注入生成器并返回内存结果与当前 lease callback。"""
    calls: list[dict[str, object]] = []

    def _result_factory(_db, run_args):
        calls.append(run_args)
        return VariantAnalysisResult()

    execution = await ScriptVariantTaskExecutionDriver(result_factory=_result_factory).execute(_command())

    assert calls == [
        {"merged_library": {"characters": []}, "all_shot_extractions": [], "script_division": {}}
    ]
    assert execution.callback.kind.value == "succeeded"
    assert execution.callback.attempt_id == "attempt-1"
    assert execution.callback.lease_epoch == 2
    assert isinstance(execution.output, VariantAnalysisResult)


async def test_script_variant_driver_rejects_invalid_snapshot_as_failed_callback() -> None:
    """快照不完整时不得调用 Agent，也不得让异常越过 Worker 边界。"""
    execution = await ScriptVariantTaskExecutionDriver().execute(_command(snapshot={"run_args": {}}))

    assert execution.callback.kind.value == "failed"
    assert execution.callback.error_code == "script_variant_failed"
    assert execution.output is None


async def test_script_variant_delivery_handler_only_serializes_result() -> None:
    """Handler 不接触 Task/领域对象，只产出 Coordinator 可写入的稳定结果。"""
    context = DeliveryContext(
        db=None,  # type: ignore[arg-type]  # 本 Handler 不应访问数据库。
        attempt=None,  # type: ignore[arg-type]
        task=None,  # type: ignore[arg-type]
        command=_command(),
        output=VariantAnalysisResult(chapter_variants={"chapter-1": ["outfit_v2"]}),
    )

    result = await ScriptVariantDeliveryHandler().deliver_success(context)

    assert result == {
        "costume_timelines": [],
        "variant_suggestions": [],
        "chapter_variants": {"chapter-1": ["outfit_v2"]},
        "notes": None,
    }
