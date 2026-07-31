"""ExperimentWorkflowHandler 的实验室消息终态投影测试。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot
from app.core.contracts.generation_delivery import (
    DeliveredArtifactPublishState,
    GenerationDeliveryResult,
    GenerationOutcome,
)
from app.core.db import Base
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.generation_artifacts import GenerationArtifact, GenerationArtifactPublishStatus
from app.services.generation.workflows.base import GenerationWorkflowTerminalContext
from app.services.generation.workflows.handlers import ExperimentWorkflowHandler


async def _session_factory(tmp_path, *, session_id: str = "session-1") -> async_sessionmaker[AsyncSession]:
    """创建包含单个实验室任务消息的临时数据库会话工厂。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'experiment-handler.db'}", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add_all(
            [
                ExperimentSession(id=session_id, lab_type="image", title="实验室"),
                ExperimentMessage(
                    id="message-1",
                    session_id=session_id,
                    sequence=1,
                    role="task",
                    content="生成中",
                    status="pending",
                    payload={"modality": "image"},
                    task_id="task-1",
                ),
            ]
        )
        await db.commit()
    return factory


def _snapshot(*, session_id: str = "session-1") -> ResolvedGenerationSnapshot:
    """构造实验室图片工作流所需的最小冻结快照。"""

    return ResolvedGenerationSnapshot.model_validate(
        {
            "model_id": "image-model-1",
            "canonical_target": {"kind": "experiment_session", "entity_id": session_id},
            "operation_input": {"kind": "image_generation"},
            "execution_prompt": "生成图片",
        }
    )


def _artifact() -> GenerationArtifact:
    """构造已归档但未自动采用的最小图片产物。"""

    return GenerationArtifact(
        id="artifact-1",
        task_id="task-1",
        modality="image",
        ordinal=0,
        file_id="file-1",
        provider_result={},
        publish_status=GenerationArtifactPublishStatus.skipped,
        publish_error="no_target_slot",
    )


@pytest.mark.asyncio
async def test_deliver_success_projects_result_to_matching_experiment_message(tmp_path) -> None:
    """成功交付必须验证会话归属，并将归档文件投影到对应任务消息。"""

    factory = await _session_factory(tmp_path)
    handler = ExperimentWorkflowHandler(operation=GenerationOperation.image_generation)
    async with factory() as db:
        result = await handler.deliver_success(
            GenerationWorkflowTerminalContext(task_id="task-1", data={"db": db, "snapshot": _snapshot(), "artifacts": [_artifact()]})
        )
        message = await db.get(ExperimentMessage, "message-1")

        assert isinstance(result, GenerationDeliveryResult)
        assert result.outcome is GenerationOutcome.succeeded
        assert result.primary_file_id == "file-1"
        assert result.artifacts[0].artifact_id == "artifact-1"
        assert result.artifacts[0].file_id == "file-1"
        assert result.artifacts[0].publish_state is DeliveredArtifactPublishState.skipped
        assert message is not None
        assert message.status == "succeeded"
        assert message.payload["result"]["primary_file_id"] == "file-1"
        assert "artifacts" not in message.payload["result"]
        assert message.payload["progress"] == 100


@pytest.mark.asyncio
async def test_deliver_success_rejects_message_from_another_session(tmp_path) -> None:
    """任务消息与快照 target 会话不一致时必须拒绝交付，防止跨会话展示结果。"""

    factory = await _session_factory(tmp_path, session_id="actual-session")
    handler = ExperimentWorkflowHandler(operation=GenerationOperation.image_generation)
    async with factory() as db:
        context = GenerationWorkflowTerminalContext(
            task_id="task-1",
            data={"db": db, "snapshot": _snapshot(session_id="target-session"), "artifacts": [_artifact()]},
        )

        with pytest.raises(ValueError, match="session mismatch"):
            await handler.deliver_success(context)


@pytest.mark.asyncio
async def test_deliver_failed_and_cancelled_project_stable_terminal_statuses(tmp_path) -> None:
    """失败与取消交付应只更新展示消息状态和稳定错误摘要，不自行提交事务。"""

    factory = await _session_factory(tmp_path)
    handler = ExperimentWorkflowHandler(operation=GenerationOperation.image_generation)
    async with factory() as db:
        data = {"db": db, "snapshot": _snapshot(), "artifacts": [_artifact()], "error": "供应商失败"}
        await handler.deliver_failed(GenerationWorkflowTerminalContext(task_id="task-1", data=data))
        message = await db.get(ExperimentMessage, "message-1")
        assert message is not None
        assert message.status == "failed"
        assert message.payload["error"] == "供应商失败"

        await handler.deliver_cancelled(GenerationWorkflowTerminalContext(task_id="task-1", data={**data, "error": ""}))
        assert message.status == "cancelled"
        assert message.payload["error"] == "任务已取消"
