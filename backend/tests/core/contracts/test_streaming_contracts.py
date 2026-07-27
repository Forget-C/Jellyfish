"""统一生成 P2 SSE 事件契约测试。"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.core.contracts.streaming import GenerationStreamEvent, GenerationStreamEventSequence


NOW = datetime(2026, 7, 27, tzinfo=UTC)


def _event(event: str, sequence: int, data: dict[str, object]) -> dict[str, object]:
    """构造测试用的最小 SSE 事件 payload。"""
    return {"version": 1, "event": event, "sequence": sequence, "created_at": NOW, "data": data}


def _accepted_data() -> dict[str, object]:
    """构造 accepted 事件所需的 canonical 用户消息。"""
    return {
        "task_id": "task-1",
        "user_message": {
            "id": "message-1",
            "session_id": "session-1",
            "role": "user",
            "content": "hello",
            "sequence": 1,
            "created_at": NOW,
            "updated_at": NOW,
        },
    }


def _completed_data() -> dict[str, object]:
    """构造 completed 事件所需的 canonical 助手消息和结果。"""
    return {
        "task_id": "task-1",
        "assistant_message": {
            "id": "message-2",
            "session_id": "session-1",
            "role": "assistant",
            "content": "world",
            "sequence": 2,
            "created_at": NOW,
            "updated_at": NOW,
        },
        "result": {"text": "world", "model_id": "model-1", "model_revision_id": "revision-1"},
    }


def test_stream_event_requires_version_one_and_matching_event_data() -> None:
    """SSE payload 固定为 v1，事件类型不能与另一类 data 组合。"""
    accepted = GenerationStreamEvent.model_validate(_event("accepted", 1, _accepted_data()))

    assert accepted.version == 1
    assert accepted.data.task_id == "task-1"

    with pytest.raises(ValidationError, match="version"):
        GenerationStreamEvent.model_validate({**_event("accepted", 1, _accepted_data()), "version": 2})
    with pytest.raises(ValidationError, match="event must match"):
        GenerationStreamEvent.model_validate(_event("delta", 2, _accepted_data()))


def test_stream_event_sequence_allows_deltas_and_heartbeats_before_one_terminal_event() -> None:
    """业务流必须以 accepted 开始并以一个终态结束，心跳不参与业务顺序。"""
    stream = GenerationStreamEventSequence.model_validate(
        [
            _event("accepted", 1, _accepted_data()),
            _event("heartbeat", 1, {"task_id": "task-1"}),
            _event("delta", 2, {"task_id": "task-1", "text_delta": "world"}),
            _event("completed", 3, _completed_data()),
        ]
    )

    assert [event.event.value for event in stream.root] == ["accepted", "heartbeat", "delta", "completed"]


@pytest.mark.parametrize(
    "events, error",
    [
        ([_event("delta", 1, {"task_id": "task-1", "text_delta": "x"}), _event("completed", 2, _completed_data())], "first business event"),
        ([_event("accepted", 1, _accepted_data()), _event("completed", 2, _completed_data()), _event("delta", 3, {"task_id": "task-1", "text_delta": "late"})], "after a terminal"),
        ([_event("accepted", 1, _accepted_data()), _event("error", 2, {"task_id": "task-1", "error": {"code": "provider_failed", "message": "failed"}}), _event("cancelled", 3, {"task_id": "task-1"})], "only one terminal"),
    ],
)
def test_stream_event_sequence_rejects_invalid_business_lifecycle(events: list[dict[str, object]], error: str) -> None:
    """非法起始、终态后写入和多终态必须在契约层被拒绝。"""
    with pytest.raises(ValidationError, match=error):
        GenerationStreamEventSequence.model_validate(events)
