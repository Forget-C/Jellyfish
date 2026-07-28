"""文本 SSE 持久化 lease 的 fencing 与过期回收回归测试。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.services.generation.runtime import text_chat_streaming


@pytest.mark.asyncio
async def test_text_stream_lease_fences_stale_owner_and_reaper_increments_epoch(tmp_path, monkeypatch) -> None:
    """新 owner 与 reaper 都会提升 epoch，旧 owner 不能续租或发布终态。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'text-stream.db'}", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(text_chat_streaming, "async_session_maker", session_local)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        now = datetime.now(UTC).replace(tzinfo=None)
        async with session_local() as db:
            db.add(
                GenerationTask(
                    id="text-task",
                    mode=GenerationDeliveryMode.streaming,
                    visibility=GenerationTaskVisibility.hidden,
                    task_kind="text_chat",
                    status=GenerationTaskStatus.streaming,
                    payload={},
                    lease_epoch=0,
                    lease_expires_at=now,
                )
            )
            await db.commit()

        first = await text_chat_streaming._claim_lease("text-task")
        assert first is not None
        async with session_local() as db:
            await db.execute(
                GenerationTask.__table__.update()
                .where(GenerationTask.id == "text-task")
                .values(lease_expires_at=now - timedelta(seconds=1))
            )
            await db.commit()

        second = await text_chat_streaming._claim_lease("text-task")
        assert second is not None
        assert second.owner != first.owner
        assert second.epoch == first.epoch + 1
        assert await text_chat_streaming._renew_lease("text-task", first) is False

        async with session_local() as db:
            await db.execute(
                GenerationTask.__table__.update()
                .where(GenerationTask.id == "text-task")
                .values(lease_expires_at=now - timedelta(seconds=1))
            )
            await db.commit()

        assert await text_chat_streaming.reap_expired_text_stream_runs() == ["text-task"]
        async with session_local() as db:
            row = await db.scalar(select(GenerationTask).where(GenerationTask.id == "text-task"))
            assert row is not None
            assert row.status == GenerationTaskStatus.failed
            assert row.error == "stream_lease_expired"
            assert row.lease_epoch == second.epoch + 1
    finally:
        await engine.dispose()
