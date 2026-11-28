"""实验会话接口最小测试。"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.routes.studio import experiment_sessions as route
from app.core.db import Base
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import Task
from app.services.task_service import TaskService
from app.services.chat.snapshots import session_snapshot
from app.schemas.studio.experiment_sessions import ExperimentSessionCreate
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages, experiment_user_message


def test_experiment_session_routes_are_registered(client: TestClient) -> None:
    """会话 API 应暴露创建与列表入口。"""
    response = client.get("/openapi.json")
    paths = response.json()["paths"]
    assert "/api/v1/studio/experiment-sessions" in paths
    messages = paths["/api/v1/studio/experiment-sessions/{session_id}/messages"]
    assert set(messages) == {"delete"}
    assert "/api/v1/studio/experiment-sessions/messages/{message_id}" not in paths
    base = "/api/v1/studio/experiment-sessions"
    message_id = "0123456789abcdef0123456789abcdef"
    assert client.post(f"{base}/fixture-session/messages", json={}).status_code == 405
    assert client.patch(f"{base}/messages/{message_id}", json={}).status_code == 404
    message_parameters = paths["/api/v1/studio/chat/sessions/{kind}/{session_id}/snapshot"]["get"]["parameters"]
    assert {parameter["name"] for parameter in message_parameters} >= {"session_id", "page", "page_size"}
    session_schema = response.json()["components"]["schemas"]["ExperimentSessionRead"]
    assert {"last_message_preview", "has_running_task"} <= set(session_schema["properties"])
    message_schema = response.json()["components"]["schemas"]["ExperimentMessageRead"]
    assert "sequence" in message_schema["properties"]


async def _build_session() -> tuple[AsyncSession, object]:
    """构造包含真实 ORM 表的隔离 SQLite 会话，验证实验历史读写语义。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return session_local(), engine


async def _snapshot_messages(db, kind, session_id, page=1, page_size=50):
    view = await session_snapshot(db, (kind, None), session_id, page, page_size)
    return view.history.messages


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
                    payload={}, sequence=index + 1, created_at=base_time + timedelta(seconds=index),
                )
                for index in range(4)
            ])
            task = await TaskService(db).submit(kind="image_generation", snapshot={},
                target_type="experiment_session", target_id=session_id)
            db.add(ExperimentMessage(id="task-message", session_id=session_id, role="task", content="图片生成中",
                task_id=task.id, status=None, payload={"modality": "image"}, sequence=5))
            await db.commit()

            page = await _snapshot_messages(db, "image", session_id, page=1, page_size=2)
            assert [item.content for item in page] == ["提示词 3", "图片生成中"]

            earlier = await _snapshot_messages(db, "image", session_id, page=2, page_size=2)
            assert [item.content for item in earlier] == ["提示词 1", "提示词 2"]

            sessions = await route.list_experiment_sessions("image", db)
            assert sessions.data is not None
            assert sessions.data[0].last_message_preview == "图片生成中"
            assert sessions.data[0].has_running_task is True
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_experiment_message_same_timestamp_uses_stable_order() -> None:
    """相同时间戳的消息也应按服务端序号返回，避免聊天气泡随机翻转。"""
    db, engine = await _build_session()
    try:
        async with db:
            created = await route.create_experiment_session(ExperimentSessionCreate(lab_type="image", title="排序回归"), db)
            assert created.data is not None
            timestamp = datetime(2026, 7, 20, tzinfo=UTC)
            db.add_all([
                ExperimentMessage(id="message-user", session_id=created.data.id, role="user", content="用户输入", payload={}, sequence=1, created_at=timestamp),
                ExperimentMessage(id="message-task", session_id=created.data.id, role="task", content="任务反馈", payload={}, sequence=2, created_at=timestamp),
            ])
            await db.commit()
            messages = await _snapshot_messages(db, "image", created.data.id, page=1, page_size=50)
            assert [item.content for item in messages] == ["用户输入", "任务反馈"]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_append_experiment_messages_reserves_continuous_sequences() -> None:
    """共享消息服务应跨多次追加持续分配连续序号，并同步会话计数器。"""
    db, engine = await _build_session()
    try:
        async with db:
            created = await route.create_experiment_session(
                ExperimentSessionCreate(lab_type="video", title="连续序号"), db
            )
            assert created.data is not None
            session_id = created.data.id

            first_batch = await append_experiment_messages(
                db,
                session_id=session_id,
                drafts=[
                    ExperimentMessageDraft(role="user", content="第一次输入"),
                    ExperimentMessageDraft(role="task", content="第一次任务", status="pending"),
                ],
            )
            second_batch = await append_experiment_messages(
                db,
                session_id=session_id,
                drafts=[ExperimentMessageDraft(role="user", content="第二次输入")],
            )
            await db.commit()

            assert [item.sequence for item in [*first_batch, *second_batch]] == [1, 2, 3]
            messages = await _snapshot_messages(db, "video", session_id, page=1, page_size=50)
            assert [item.sequence for item in messages] == [1, 2, 3]
            counter = await db.scalar(
                select(ExperimentSession.message_sequence).where(ExperimentSession.id == session_id)
            )
            assert counter == 3
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("mysql", [False, pytest.param(True, marks=pytest.mark.integration)])
async def test_concurrent_message_appends_receive_distinct_sequences(tmp_path, mysql) -> None:
    """并发追加同一会话后，历史以独立、连续的服务端序号返回。"""
    if mysql:
        from tests.services.test_task_mysql import isolated_database_url
        database_url = isolated_database_url()
    else:
        database_url = f"sqlite+aiosqlite:///{tmp_path / 'concurrent-messages.db'}"
    engine = create_async_engine(database_url)
    session_local = async_sessionmaker(engine, expire_on_commit=False)
    try:
        if not mysql:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
        async with session_local() as db:
            session = await route.create_experiment_session(ExperimentSessionCreate(lab_type="text"), db)
        session_id = session.data.id

        async def append(content: str) -> None:
            async with session_local.begin() as db:
                await append_experiment_messages(
                    db, session_id=session_id, drafts=[experiment_user_message(prompt=content, model_id=None)],
                )

        try:
            await asyncio.gather(append("并发输入 A"), append("并发输入 B"))
            async with session_local() as db:
                history = await _snapshot_messages(db, "text", session_id, page=1, page_size=50)
                assert [item.sequence for item in history] == [1, 2]
                assert {item.content for item in history} == {"并发输入 A", "并发输入 B"}
        finally:
            async with session_local() as db:
                await route.delete_experiment_session(session_id, db)
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
            await append_experiment_messages(
                db, session_id=session_id, drafts=[experiment_user_message(prompt="生成视频", model_id=None)],
            )
            task = await TaskService(db).submit(kind="video_generation", snapshot={},
                target_type="experiment_session", target_id=session_id)
            # 故意不创建任务消息，活动保护必须仍来自任务主表。
            await db.commit()

            with pytest.raises(HTTPException, match="cannot be cleared"):
                await route.clear_experiment_messages(session_id, db)
            with pytest.raises(HTTPException, match="cannot be deleted"):
                await route.delete_experiment_session(session_id, db)

            await TaskService(db).request_cancel(task.id)
            await db.commit()

            await route.clear_experiment_messages(session_id, db)
            assert await _snapshot_messages(db, "video", session_id) == []
            await route.delete_experiment_session(session_id, db)
            with pytest.raises(HTTPException, match="target_not_found"):
                await _snapshot_messages(db, "video", session_id)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal", ["succeeded", "failed", "cancelled"])
async def test_task_message_status_is_read_projection_and_rejects_cross_session(terminal):
    """任务状态只在 TaskService 维护；消息不存副本，也不展示其他会话的结果。"""
    from app.services.studio.experiment_messages import read_experiment_messages

    db, engine = await _build_session()
    try:
        async with db:
            db.add_all([ExperimentSession(id="owner", lab_type="text"), ExperimentSession(id="other", lab_type="text")])
            await db.flush()
            service = TaskService(db)
            task = await service.submit(kind="text_chat", snapshot={}, target_type="experiment_session", target_id="owner")
            message = (await append_experiment_messages(db, session_id="owner", drafts=[
                ExperimentMessageDraft(role="task", content="生成中", task_id=task.id, payload={"modality": "text"}),
            ]))[0]
            foreign_task = await service.submit(kind="text_chat", snapshot={}, target_type="experiment_session", target_id="owner")
            await service.claim(foreign_task.id, worker_id="worker")
            await service.finish(foreign_task.id, result={"text": "其他会话内容"})
            foreign = (await append_experiment_messages(db, session_id="other", drafts=[
                ExperimentMessageDraft(role="task", content="错误关联", task_id=foreign_task.id, payload={"modality": "text"}),
            ]))[0]
            await db.commit()
            assert (await read_experiment_messages(db, [message]))[0].status == "queued"
            await service.claim(task.id, worker_id="worker")
            await service.report_progress(task.id, progress=30, stage="generating")
            assert (await read_experiment_messages(db, [message]))[0].status == "running"
            if terminal == "succeeded":
                await service.finish(task.id, result={"text": "结果"})
            elif terminal == "failed":
                await service.finish(task.id, error_code="provider_failed", error="供应商失败")
            else:
                await service.request_cancel(task.id)
                await service.finish(task.id, result={"text": "迟到结果"})
            await db.commit()
            views = await read_experiment_messages(db, [message, foreign])
            assert views[0].status == terminal
            assert views[1].status is None and "result" not in views[1].payload
            if terminal == "succeeded":
                assert views[0].payload["result"] == {"text": "结果"}
            else:
                assert views[0].payload["error"]
            await db.refresh(message)
            assert message.status is None and message.payload == {"modality": "text"}
    finally:
        await engine.dispose()
