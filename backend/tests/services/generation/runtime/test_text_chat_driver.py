"""持久化异步文本聊天的 Attempt Driver / DeliveryHandler 回归测试。"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.execution_attempt import ExecutionAttemptCallback, ExecutionAttemptCallbackKind, ExecutionAttemptLease
from app.core.db import Base
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.models.task_links import GenerationTaskLink
from app.services.execution_attempt_repository import ExecutionAttemptRepository
from app.services.execution_attempt_runtime import AttemptCallbackDisposition, AttemptTerminalCoordinator, DriverExecution, TaskExecutionCommand
from app.services.generation.runtime.text_chat_driver import TextChatDeliveryHandler


def _snapshot() -> dict[str, object]:
    """构建后台文本任务唯一需要的冻结快照。"""
    return {
        "model_id": "text-model",
        "canonical_target": {"kind": "experiment_session", "entity_id": "session-1", "slot_id": None},
        "expected_version_id": None,
        "media": None,
        "operation_input": {
            "kind": "text_chat",
            "messages": [{"role": "user", "content": "你好", "sequence": 1}],
        },
        "execution_prompt": None,
    }


@pytest.mark.asyncio
async def test_text_chat_delivery_is_fenced_and_projects_one_assistant_message(tmp_path) -> None:
    """重复成功 callback 不得重复追加助手消息或覆盖 Task 终态。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'text-attempt.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(ExperimentSession(id="session-1", lab_type="text", message_sequence=1))
        task = GenerationTask(
            id="task-1",
            mode=GenerationDeliveryMode.async_polling,
            visibility=GenerationTaskVisibility.task_center,
            task_kind="text_chat",
            status=GenerationTaskStatus.running,
            payload={"snapshot": _snapshot()},
        )
        db.add(task)
        db.add(
            GenerationTaskLink(
                task_id=task.id,
                resource_type="text",
                relation_type="experiment_session",
                relation_entity_id="session-1",
            )
        )
        db.add(
            ExperimentMessage(
                id="task-message-1",
                session_id="session-1",
                sequence=1,
                role="task",
                content="文本生成任务已提交，正在等待生成结果。",
                status="pending",
                payload={"modality": "text"},
                task_id=task.id,
            )
        )
        await db.flush()
        attempts = ExecutionAttemptRepository(db)
        attempt = await attempts.create_queued(task_id=task.id)
        assert await attempts.claim(attempt_id=attempt.id, owner="worker-a", ttl_seconds=30) == 1
        assert await attempts.begin_execution(attempt_id=attempt.id, owner="worker-a", lease_epoch=1)
        command = TaskExecutionCommand(
            lease=ExecutionAttemptLease(
                attempt_id=attempt.id,
                task_id=task.id,
                lease_epoch=1,
                lease_owner="worker-a",
                lease_ttl_seconds=30,
            ),
            task_kind="text_chat",
            snapshot=_snapshot(),
            cancel_requested=False,
        )
        execution = DriverExecution(
            callback=ExecutionAttemptCallback(
                attempt_id=attempt.id,
                lease_epoch=1,
                kind=ExecutionAttemptCallbackKind.succeeded,
            ),
            output="这是回答",
        )
        coordinator = AttemptTerminalCoordinator()

        assert await coordinator.terminalize(
            db=db,
            command=command,
            execution=execution,
            handler=TextChatDeliveryHandler(),
        ) is AttemptCallbackDisposition.accepted
        assert await coordinator.terminalize(
            db=db,
            command=command,
            execution=execution,
            handler=TextChatDeliveryHandler(),
        ) is AttemptCallbackDisposition.ignored_duplicate
        await db.refresh(task)
        await db.refresh(attempt)
        messages = list((await db.scalars(select(ExperimentMessage).order_by(ExperimentMessage.sequence))).all())

        assert task.status == GenerationTaskStatus.succeeded
        assert task.result["text"] == "这是回答"
        assert attempt.status == "terminal"
        assert [(message.role, message.content, message.status) for message in messages] == [
            ("task", "文本生成任务已提交，正在等待生成结果。", "succeeded"),
            ("assistant", "这是回答", None),
        ]
    await engine.dispose()
