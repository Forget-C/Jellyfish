"""文本 SSE 仅持久化实验消息、不创建异步任务的回归测试。"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.experiment_sessions import ExperimentSession
from app.models.task import Task
from app.services.generation.runtime import text_chat_streaming


@pytest.mark.asyncio
async def test_text_stream_creates_message_without_generation_task(tmp_path, monkeypatch) -> None:
    """SSE 文本运行只写用户消息，run 状态保持在进程内运行时。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'text-stream.db'}", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(text_chat_streaming, "async_session_maker", session_local)
    monkeypatch.setattr(text_chat_streaming, "build_text_chat_model", AsyncMock(return_value=object()))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        async with session_local() as db:
            db.add(ExperimentSession(id="text-session", lab_type="text"))
            await db.commit()
            run_id, accepted = await text_chat_streaming.create_text_stream_run(
                db, session_id="text-session", model_id="text-model", content="你好"
            )
            await db.commit()

        assert accepted.data.task_id == run_id
        expected = {"version": 1, "prompt": "你好", "model_id": "text-model"}
        assert accepted.data.user_message.payload["input_snapshot"] == expected
        from app.api.v1.routes.studio.experiment_sessions import list_experiment_messages
        async with session_local() as db:
            history = await list_experiment_messages("text-session", db, page=1, page_size=50)
            assert history.data[0].payload["input_snapshot"] == expected
        async with session_local() as db:
            assert list((await db.scalars(select(Task))).all()) == []
        assert await text_chat_streaming.request_text_stream_cancel(
            session_id="text-session", task_id=run_id, reason="user_cancelled"
        )
        assert await text_chat_streaming.reap_expired_text_stream_runs() == []
    finally:
        await engine.dispose()
