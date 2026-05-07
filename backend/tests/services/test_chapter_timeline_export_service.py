"""章节时间线导出：活跃任务查询与可导出性校验。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.studio import Chapter, Project, ProjectStyle, ProjectVisualStyle
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus
from app.models.task_links import GenerationTaskLink
from app.schemas.studio.chapter_timeline import (
    ChapterTimelineRead,
    ChapterTimelineSegmentRead,
    TimelineClipStatus,
)
from app.services.studio.chapter_timeline_export import (
    ensure_timeline_exportable,
    find_active_chapter_timeline_export_task_id,
)


async def _session() -> tuple[AsyncSession, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return maker(), engine


async def _seed(db: AsyncSession) -> None:
    db.add_all(
        [
            Project(
                id="p1",
                name="P",
                description="",
                style=ProjectStyle.real_people_city,
                visual_style=ProjectVisualStyle.live_action,
            ),
            Chapter(id="c1", project_id="p1", index=1, title="第一章"),
        ],
    )
    await db.commit()


@pytest.mark.asyncio
async def test_find_active_returns_pending_export_task_id() -> None:
    db, engine = await _session()
    async with db:
        await _seed(db)
        db.add_all(
            [
                GenerationTask(
                    id="t-exp",
                    mode=GenerationDeliveryMode.async_polling,
                    task_kind="chapter_timeline_export",
                    status=GenerationTaskStatus.pending,
                    payload={},
                ),
                GenerationTaskLink(
                    task_id="t-exp",
                    resource_type="video",
                    relation_type="chapter_timeline_export",
                    relation_entity_id="c1",
                ),
            ],
        )
        await db.commit()
        active = await find_active_chapter_timeline_export_task_id(db, "c1")
        assert active == "t-exp"
    await engine.dispose()


@pytest.mark.asyncio
async def test_find_active_ignores_succeeded_tasks() -> None:
    db, engine = await _session()
    async with db:
        await _seed(db)
        db.add_all(
            [
                GenerationTask(
                    id="t-done",
                    mode=GenerationDeliveryMode.async_polling,
                    task_kind="chapter_timeline_export",
                    status=GenerationTaskStatus.succeeded,
                    payload={},
                ),
                GenerationTaskLink(
                    task_id="t-done",
                    resource_type="video",
                    relation_type="chapter_timeline_export",
                    relation_entity_id="c1",
                ),
            ],
        )
        await db.commit()
        assert await find_active_chapter_timeline_export_task_id(db, "c1") is None
    await engine.dispose()


def test_ensure_timeline_exportable_raises_on_empty() -> None:
    with pytest.raises(ValueError, match="时间线为空"):
        ensure_timeline_exportable(ChapterTimelineRead(layout_version=1, segments=[]))


def test_ensure_timeline_exportable_raises_on_not_ready() -> None:
    read = ChapterTimelineRead(
        layout_version=1,
        segments=[
            ChapterTimelineSegmentRead(
                id="",
                shot_id="s1",
                position=0,
                clip_status=TimelineClipStatus.missing_video,
                label="",
            ),
        ],
    )
    with pytest.raises(ValueError, match="未就绪"):
        ensure_timeline_exportable(read)
