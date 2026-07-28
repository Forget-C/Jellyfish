"""实验室统一任务路由的事务边界与路径绑定测试。"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.api.v1.routes.studio import lab_generation_tasks as route
from app.core.contracts.generation import (
    GenerationSubmitRequest,
    ImageGenerationOperationInput,
    VideoGenerationOperationInput,
)
from app.models.experiment_sessions import ExperimentMessage
from app.services.generation.submission import GenerationAccepted


class _DummyDB:
    """记录提交和刷新顺序的最小数据库会话替身。"""

    def __init__(self, lab_type: str = "image") -> None:
        """构造具有目标实验室类型的会话替身。"""

        self.session = SimpleNamespace(lab_type=lab_type, updated_at=None)
        self.commits = 0
        self.refreshed: list[object] = []

    async def get(self, _model, _session_id):  # noqa: ANN001
        """返回已存在的实验会话。"""

        return self.session

    async def commit(self) -> None:
        """记录任务和消息完成同一事务提交。"""

        self.commits += 1

    async def refresh(self, item: object) -> None:
        """记录返回前刷新权威消息。"""

        self.refreshed.append(item)


class _Submitter:
    """捕获统一命令且不触及真实门禁的提交器替身。"""

    command = None

    def __init__(self, *, entity_gate) -> None:  # noqa: ANN001
        """保持生产注入形状。"""

    async def submit_async(self, _db, command):  # noqa: ANN001
        """返回固定任务标识供消息关联断言。"""

        type(self).command = command
        return GenerationAccepted(task_id="task-1")


def _message(message_id: str, role: str) -> ExperimentMessage:
    """构造可由响应 schema 序列化的实验室消息。"""

    timestamp = datetime.now(UTC)
    return ExperimentMessage(
        id=message_id,
        session_id="session-1",
        sequence=1 if role == "user" else 2,
        role=role,
        content="最终提示词",
        status="pending" if role == "task" else None,
        payload={},
        created_at=timestamp,
        updated_at=timestamp,
    )


@pytest.mark.anyio
async def test_image_lab_task_creates_messages_before_snapshot_and_enqueues_after_commit(monkeypatch) -> None:
    """图片实验室提交必须以消息、快照任务、提交、投递的固定顺序完成。"""

    db = _DummyDB()
    user_message, task_message = _message("user-1", "user"), _message("task-message-1", "task")
    events: list[str] = []

    async def _append(_db, *, session_id, drafts):  # noqa: ANN001
        assert session_id == "session-1"
        assert [draft.role for draft in drafts] == ["user", "task"]
        assert drafts[0].content == "实验图片"
        events.append("messages")
        return user_message, task_message

    async def _submit(self, _db, command):  # noqa: ANN001
        assert events == ["messages"]
        type(self).command = command
        events.append("task")
        return GenerationAccepted(task_id="task-1")

    monkeypatch.setattr(route, "append_experiment_messages", _append)
    monkeypatch.setattr(route, "GenerationSubmitter", _Submitter)
    monkeypatch.setattr(_Submitter, "submit_async", _submit)
    monkeypatch.setattr(route, "enqueue_task_execution", lambda task_id: events.append(f"enqueue:{task_id}:{db.commits}"))

    response = await route.submit_image_lab_generation_task(
        "session-1",
        GenerationSubmitRequest(
            model_id="image-model",
            execution_prompt="实验图片",
            operation_input=ImageGenerationOperationInput(),
        ),
        db,
    )

    assert response.data.task_id == "task-1"
    assert task_message.task_id == "task-1"
    assert _Submitter.command.target.kind.value == "experiment_session"
    assert _Submitter.command.target.entity_id == "session-1"
    assert _Submitter.command.modality.value == "image"
    assert events == ["messages", "task", "enqueue:task-1:1"]
    assert db.refreshed == [user_message, task_message]


@pytest.mark.anyio
async def test_video_lab_task_binds_video_modality_and_rejects_wrong_session_type(monkeypatch) -> None:
    """视频路径固定视频 operation，且不能写入图片实验会话。"""

    db = _DummyDB(lab_type="video")
    user_message, task_message = _message("user-1", "user"), _message("task-message-1", "task")

    async def _append(*_args, **_kwargs):  # noqa: ANN001
        return user_message, task_message

    monkeypatch.setattr(route, "append_experiment_messages", _append)
    monkeypatch.setattr(route, "GenerationSubmitter", _Submitter)
    monkeypatch.setattr(route, "enqueue_task_execution", lambda _task_id: None)
    await route.submit_video_lab_generation_task(
        "session-1",
        GenerationSubmitRequest(
            model_id="video-model",
            execution_prompt="实验视频",
            operation_input=VideoGenerationOperationInput(ratio="16:9"),
        ),
        db,
    )
    assert _Submitter.command.modality.value == "video"
    assert _Submitter.command.operation.value == "video_generation"

    wrong_type_db = _DummyDB(lab_type="image")
    with pytest.raises(Exception) as error:
        await route.submit_video_lab_generation_task(
            "session-1",
            GenerationSubmitRequest(
                model_id="video-model",
                execution_prompt="实验视频",
                operation_input=VideoGenerationOperationInput(ratio="16:9"),
            ),
            wrong_type_db,
        )
    assert getattr(error.value, "detail", None) == "experiment_session_type_invalid"
