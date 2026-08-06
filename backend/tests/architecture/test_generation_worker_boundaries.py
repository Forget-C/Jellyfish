"""已迁移生成 Worker 的架构边界护栏。"""

from __future__ import annotations

from pathlib import Path


def test_generation_worker_does_not_write_task_or_delivery_state_directly() -> None:
    """图片/视频 Worker 只能执行 Provider，终态与归档必须回到 Coordinator。"""
    worker_source = (Path(__file__).parents[2] / "app/services/generation/runtime/workers.py").read_text()

    forbidden = (
        "SqlAlchemyTaskStore",
        "TaskFinalizer",
        "ArtifactStore",
        "complete_success",
        "complete_failure",
        "mark_cancelled",
        "deliver_success",
        "deliver_failed",
        "deliver_cancelled",
    )

    assert not [symbol for symbol in forbidden if symbol in worker_source]
