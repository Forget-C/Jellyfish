"""ExperimentWorkflowHandler 的提交期与执行期资源复核测试。"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.generation import (
    GenerationCommand,
    GenerationDelivery,
    GenerationModality,
    GenerationOperation,
    GenerationSubmitRequest,
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.db import Base
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.services.generation.workflows.base import (
    GenerationWorkflowExecutionContext,
    GenerationWorkflowSubmissionContext,
)
from app.services.generation.workflows.handlers import ExperimentWorkflowHandler


async def _session_factory(tmp_path) -> async_sessionmaker[AsyncSession]:
    """创建隔离 SQLite 数据库，供 Handler 直接复核实验室资源。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'experiment-workflow-validation.db'}", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return factory


def _image_command(*, session_id: str) -> GenerationCommand:
    """构造图片实验室提交命令，目标会话由调用方指定。"""

    return GenerationCommand(
        modality=GenerationModality.image,
        operation=GenerationOperation.image_generation,
        delivery=GenerationDelivery.async_polling,
        target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id=session_id),
        request=GenerationSubmitRequest(
            model_id="image-model-1",
            execution_prompt="生成水母图片",
            operation_input=ImageGenerationOperationInput(),
        ),
    )


def _image_snapshot(*, session_id: str) -> ResolvedGenerationSnapshot:
    """构造执行期需要的最小冻结图片快照。"""

    return ResolvedGenerationSnapshot.model_validate(
        {
            "model_id": "image-model-1",
            "canonical_target": {"kind": "experiment_session", "entity_id": session_id},
            "operation_input": {"kind": "image_generation"},
            "execution_prompt": "生成水母图片",
        }
    )


@pytest.mark.asyncio
async def test_validate_submission_rejects_image_operation_for_video_lab(tmp_path) -> None:
    """提交期必须阻止图片任务进入视频实验室会话。"""

    factory = await _session_factory(tmp_path)
    async with factory() as db:
        db.add(ExperimentSession(id="video-session", lab_type="video", title="视频实验室"))
        await db.commit()

        handler = ExperimentWorkflowHandler(operation=GenerationOperation.image_generation)
        context = GenerationWorkflowSubmissionContext(data={"db": db, "command": _image_command(session_id="video-session")})

        with pytest.raises(HTTPException) as exc_info:
            await handler.validate_submission(context)

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "experiment_session_type_invalid"


@pytest.mark.asyncio
async def test_validate_execution_rejects_missing_task_message(tmp_path) -> None:
    """执行前没有对应任务消息时必须拒绝，避免产生无法展示的实验室结果。"""

    factory = await _session_factory(tmp_path)
    async with factory() as db:
        db.add(ExperimentSession(id="image-session", lab_type="image", title="图片实验室"))
        await db.commit()

        handler = ExperimentWorkflowHandler(operation=GenerationOperation.image_generation)
        context = GenerationWorkflowExecutionContext(
            task_id="missing-task-message",
            data={"db": db, "snapshot": _image_snapshot(session_id="image-session")},
        )

        with pytest.raises(HTTPException) as exc_info:
            await handler.validate_execution(context)

        assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_validate_execution_rejects_task_message_from_another_session(tmp_path) -> None:
    """执行前必须阻止任务消息跨会话关联，防止结果被投影到错误历史。"""

    factory = await _session_factory(tmp_path)
    async with factory() as db:
        db.add_all(
            [
                ExperimentSession(id="target-session", lab_type="image", title="目标实验室"),
                ExperimentSession(id="other-session", lab_type="image", title="其他实验室"),
                ExperimentMessage(
                    id="message-1",
                    session_id="other-session",
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

        handler = ExperimentWorkflowHandler(operation=GenerationOperation.image_generation)
        context = GenerationWorkflowExecutionContext(
            task_id="task-1",
            data={"db": db, "snapshot": _image_snapshot(session_id="target-session")},
        )

        with pytest.raises(HTTPException) as exc_info:
            await handler.validate_execution(context)

        assert exc_info.value.status_code == 404
