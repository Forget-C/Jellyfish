"""剧本合并 Attempt Driver / DeliveryHandler 的纯执行边界测试。"""

from __future__ import annotations

from app.core.contracts.execution_attempt import ExecutionAttemptLease
from app.schemas.skills.script_processing import EntityMergeResult
from app.services.execution_attempt_runtime import DeliveryContext, TaskExecutionCommand
from app.services.generation.runtime.script_merge_driver import ScriptMergeDeliveryHandler, ScriptMergeTaskExecutionDriver


def _command(snapshot: dict[str, object] | None = None) -> TaskExecutionCommand:
    """构造已冻结的实体合并输入，不依赖持久化任务状态。"""
    return TaskExecutionCommand(
        lease=ExecutionAttemptLease(attempt_id="attempt-1", task_id="task-1", lease_epoch=2, lease_owner="worker-1", lease_ttl_seconds=30),
        task_kind="script_merge",
        snapshot=snapshot or {"run_args": {"all_shot_extractions": [], "historical_library": {}, "script_division": {}}},
        cancel_requested=False,
    )


async def test_script_merge_driver_returns_memory_result_without_task_write() -> None:
    """Driver 只复用既有生成器并返回当前 Attempt callback。"""
    calls: list[dict[str, object]] = []

    def _result_factory(_db, run_args):  # noqa: ANN001
        calls.append(run_args)
        return EntityMergeResult.model_validate({"merged_library": {"total_entries": 0}})

    execution = await ScriptMergeTaskExecutionDriver(result_factory=_result_factory).execute(_command())

    assert execution.callback.kind.value == "succeeded"
    assert execution.callback.attempt_id == "attempt-1"
    assert calls == [{"all_shot_extractions": [], "historical_library": {}, "script_division": {}, "previous_merge": None, "conflict_resolutions": None}]


async def test_script_merge_rejects_unfrozen_required_input() -> None:
    """缺少镜头提取列表时不得调用 Agent，直接生成失败 callback。"""
    execution = await ScriptMergeTaskExecutionDriver().execute(_command({"run_args": {}}))

    assert execution.callback.kind.value == "failed"
    assert execution.callback.error_code == "script_merge_failed"


async def test_script_merge_delivery_handler_only_serializes_result() -> None:
    """DeliveryHandler 不写入实体库，只返回 Coordinator 可提交的 JSON。"""
    context = DeliveryContext(
        db=None,  # type: ignore[arg-type]
        attempt=None,  # type: ignore[arg-type]
        task=None,  # type: ignore[arg-type]
        command=_command(),
        output=EntityMergeResult.model_validate({"merged_library": {"total_entries": 0}, "notes": "ok"}),
    )

    assert await ScriptMergeDeliveryHandler().deliver_success(context) == {
        "merged_library": {"characters": [], "locations": [], "scenes": [], "props": [], "total_entries": 0},
        "merge_stats": {}, "conflicts": [], "notes": "ok",
    }
