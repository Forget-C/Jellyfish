"""文本流式运行时的状态机、重放与取消回归测试。"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from app.core.contracts.streaming import (
    StreamAcceptedData,
    StreamCancelledData,
    StreamDeltaData,
    StreamErrorData,
    StreamErrorDetail,
)
from app.services.generation.runtime.text_streaming import (
    TextStreamRunState,
    TextStreamRunStateError,
    TextStreamingRuntime,
)


NOW = datetime(2026, 7, 28, tzinfo=UTC)


def _accepted(task_id: str = "task-1") -> StreamAcceptedData:
    """构造可持久化用户消息对应的 accepted 事件数据。"""
    return StreamAcceptedData.model_validate(
        {
            "task_id": task_id,
            "user_message": {
                "id": "user-1",
                "session_id": "session-1",
                "role": "user",
                "content": "写一个场景",
                "sequence": 1,
                "created_at": NOW,
                "updated_at": NOW,
            },
        }
    )


@pytest.mark.asyncio
async def test_runtime_assigns_monotonic_sse_ids_and_replays_after_cursor() -> None:
    """accepted、增量和错误终态共享严格递增的 sequence/SSE id。"""
    runtime = TextStreamingRuntime()

    accepted = await runtime.create_run(_accepted())
    delta = await runtime.emit_delta("task-1", StreamDeltaData(task_id="task-1", text_delta="开场"))
    failed = await runtime.fail(
        "task-1",
        StreamErrorData(
            task_id="task-1",
            error=StreamErrorDetail(code="provider_failed", message="上游不可用", retryable=True),
        ),
    )

    assert [accepted.sequence, delta.sequence, failed.sequence] == [1, 2, 3]
    assert [event.event.value for event in await runtime.replay("task-1", after_event_id=1)] == ["delta", "error"]
    assert await runtime.state_of("task-1") == TextStreamRunState.failed


@pytest.mark.asyncio
async def test_runtime_subscriber_replays_then_receives_terminal_event() -> None:
    """晚连接订阅者先拿到事件日志，再在 completed 后自然结束。"""
    runtime = TextStreamingRuntime()
    await runtime.create_run(_accepted())
    await runtime.emit_delta("task-1", StreamDeltaData(task_id="task-1", text_delta="第一段"))

    received: list[str] = []

    async def _consume() -> None:
        """订阅运行并记录传输顺序。"""
        async for event in runtime.subscribe("task-1"):
            received.append(event.event.value)

    consumer = asyncio.create_task(_consume())
    await asyncio.sleep(0)
    await runtime.cancel("task-1", "用户停止")
    await asyncio.wait_for(consumer, timeout=1)

    assert received == ["accepted", "delta", "cancelled"]
    assert await runtime.state_of("task-1") == TextStreamRunState.cancelled


@pytest.mark.asyncio
async def test_runtime_cancellation_blocks_success_and_preserves_terminal_reason() -> None:
    """取消标记给执行循环检查，随后只能由 cancelled 结束本次运行。"""
    runtime = TextStreamingRuntime()
    await runtime.create_run(_accepted())

    assert await runtime.request_cancel("task-1", "客户端断开") is True
    assert await runtime.is_cancel_requested("task-1") is True
    cancelled = await runtime.cancel("task-1")

    assert cancelled.data == StreamCancelledData(task_id="task-1", reason="客户端断开")
    assert await runtime.request_cancel("task-1", "重复取消") is False
    with pytest.raises(TextStreamRunStateError, match="terminated"):
        await runtime.emit_delta("task-1", StreamDeltaData(task_id="task-1", text_delta="late"))
