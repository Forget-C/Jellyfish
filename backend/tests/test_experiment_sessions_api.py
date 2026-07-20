"""实验会话接口最小测试。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.routes.studio import experiment_sessions as route
from app.core.db import Base
from app.models.experiment_sessions import ExperimentMessage
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus
from app.schemas.studio.experiment_sessions import ExperimentMessageCreate, ExperimentSessionCreate


def test_experiment_session_routes_are_registered(client: TestClient) -> None:
    """会话 API 应暴露创建与列表入口。"""
    response = client.get("/openapi.json")
    paths = response.json()["paths"]
    assert "/api/v1/studio/experiment-sessions" in paths
    assert "/api/v1/studio/experiment-sessions/{session_id}/messages" in paths
    message_parameters = paths["/api/v1/studio/experiment-sessions/{session_id}/messages"]["get"]["parameters"]
    assert {parameter["name"] for parameter in message_parameters} >= {"session_id", "page", "page_size"}
    session_schema = response.json()["components"]["schemas"]["ExperimentSessionRead"]
    assert {"last_message_preview", "has_running_task"} <= set(session_schema["properties"])


async def _build_session() -> tuple[AsyncSession, object]:
    """构造包含真实 ORM 表的隔离 SQLite 会话，验证实验历史读写语义。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return session_local(), engine


@pytest.mark.asyncio
async def test_experiment_message_pagination_returns_chronological_page_and_session_summary() -> None:
    """消息分页应从最新页倒查，并在每页内维持用户阅读所需的正序。"""
    db, engine = await _build_session()
    try:
        async with db:
            created = await route.create_experiment_session(
                ExperimentSessionCreate(lab_type="image", title="图片回归"), db
            )
            assert created.data is not None
            session_id = created.data.id
            base_time = datetime(2026, 7, 20, tzinfo=UTC)
            db.add_all([
                ExperimentMessage(
                    id=f"message-{index}", session_id=session_id, role="user", content=f"提示词 {index}",
                    payload={}, created_at=base_time + timedelta(seconds=index),
                )
                for index in range(4)
            ])
            db.add(GenerationTask(
                id="task-running", mode=GenerationDeliveryMode.async_polling,
                task_kind="image_generation", status=GenerationTaskStatus.running, payload={}, error="",
            ))
            db.add(ExperimentMessage(
                id="task-message", session_id=session_id, role="task", content="图片生成中",
                task_id="task-running", status="running", payload={},
                created_at=base_time + timedelta(seconds=5),
            ))
            await db.commit()

            page = await route.list_experiment_messages(session_id, db, page=1, page_size=2)
            assert page.data is not None
            assert [item.content for item in page.data] == ["提示词 3", "图片生成中"]

            earlier = await route.list_experiment_messages(session_id, db, page=2, page_size=2)
            assert earlier.data is not None
            assert [item.content for item in earlier.data] == ["提示词 1", "提示词 2"]

            sessions = await route.list_experiment_sessions("image", db)
            assert sessions.data is not None
            assert sessions.data[0].last_message_preview == "图片生成中"
            assert sessions.data[0].has_running_task is True
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_experiment_session_clear_and_delete_block_only_active_tasks() -> None:
    """运行中任务保护历史；任务结束后允许清空和删除会话。"""
    db, engine = await _build_session()
    try:
        async with db:
            created = await route.create_experiment_session(
                ExperimentSessionCreate(lab_type="video", title="视频回归"), db
            )
            assert created.data is not None
            session_id = created.data.id
            await route.create_experiment_message(
                session_id, ExperimentMessageCreate(role="user", content="生成视频"), db
            )
            db.add(GenerationTask(
                id="task-active", mode=GenerationDeliveryMode.async_polling,
                task_kind="video_generation", status=GenerationTaskStatus.pending, payload={}, error="",
            ))
            db.add(ExperimentMessage(
                id="task-active-message", session_id=session_id, role="task", content="生成中",
                task_id="task-active", status="pending", payload={},
            ))
            await db.commit()

            with pytest.raises(HTTPException, match="cannot be cleared"):
                await route.clear_experiment_messages(session_id, db)
            with pytest.raises(HTTPException, match="cannot be deleted"):
                await route.delete_experiment_session(session_id, db)

            task = await db.get(GenerationTask, "task-active")
            assert task is not None
            task.status = GenerationTaskStatus.succeeded
            await db.commit()

            await route.clear_experiment_messages(session_id, db)
            assert (await route.list_experiment_messages(session_id, db, page=1, page_size=50)).data == []
            await route.delete_experiment_session(session_id, db)
            with pytest.raises(HTTPException, match="not found"):
                await route.list_experiment_messages(session_id, db)
    finally:
        await engine.dispose()
