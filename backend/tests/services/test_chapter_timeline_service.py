"""章节时间线服务单元测试（sqlite 内存库）。"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.studio import (
    Chapter,
    ChapterTimelineSegment,
    ChapterTimelineState,
    FileItem,
    FileType,
    Project,
    ProjectStyle,
    ProjectVisualStyle,
    Shot,
)
from app.schemas.studio.chapter_timeline import ChapterTimelineWrite
from app.services.studio.chapter_timeline import (
    TimelineLayoutConflictError,
    build_timeline_read,
    replace_timeline_segments,
)


async def _make_session() -> tuple[AsyncSession, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return session_local(), engine


async def _seed_minimal_chapter(db: AsyncSession) -> None:
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
            Shot(id="s1", chapter_id="c1", index=0, title="镜1"),
            Shot(id="s2", chapter_id="c1", index=1, title="镜2"),
        ],
    )
    await db.commit()


@pytest.mark.asyncio
async def test_build_timeline_merges_saved_order_then_remaining_shots_by_index() -> None:
    db, engine = await _make_session()
    async with db:
        await _seed_minimal_chapter(db)
        db.add_all(
            [
                ChapterTimelineSegment(
                    id="seg-b",
                    chapter_id="c1",
                    shot_id="s2",
                    position=0,
                ),
                ChapterTimelineSegment(
                    id="seg-a",
                    chapter_id="c1",
                    shot_id="s1",
                    position=1,
                ),
            ],
        )
        await db.commit()

        read = await build_timeline_read(db, "c1")
        assert [x.shot_id for x in read.segments] == ["s2", "s1"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_build_timeline_default_shot_index_when_no_segments() -> None:
    db, engine = await _make_session()
    async with db:
        await _seed_minimal_chapter(db)
        read = await build_timeline_read(db, "c1")
        assert [x.shot_id for x in read.segments] == ["s1", "s2"]
        assert all(x.id == "" for x in read.segments)
    await engine.dispose()


@pytest.mark.asyncio
async def test_clip_status_missing_video_and_ready() -> None:
    db, engine = await _make_session()
    async with db:
        await _seed_minimal_chapter(db)
        db.add(
            FileItem(
                id="fv1",
                type=FileType.video,
                name="v",
                thumbnail="",
                tags=[],
                storage_key="k",
            ),
        )
        s1 = await db.get(Shot, "s1")
        assert s1 is not None
        s1.generated_video_file_id = "fv1"
        await db.commit()

        read = await build_timeline_read(db, "c1")
        by_shot = {x.shot_id: x for x in read.segments}
        assert by_shot["s1"].clip_status.value == "ready"
        assert by_shot["s2"].clip_status.value == "missing_video"
    await engine.dispose()


@pytest.mark.asyncio
async def test_replace_timeline_rejects_unknown_and_duplicate_shots() -> None:
    db, engine = await _make_session()
    async with db:
        await _seed_minimal_chapter(db)
        with pytest.raises(ValueError, match="不属于该章节"):
            await replace_timeline_segments(
                db,
                "c1",
                ChapterTimelineWrite(segments=[{"shot_id": "other"}]),
            )
        with pytest.raises(ValueError, match="重复"):
            await replace_timeline_segments(
                db,
                "c1",
                ChapterTimelineWrite(
                    segments=[
                        {"shot_id": "s1"},
                        {"shot_id": "s1"},
                    ],
                ),
            )
    await engine.dispose()


@pytest.mark.asyncio
async def test_replace_timeline_layout_version_conflict() -> None:
    db, engine = await _make_session()
    async with db:
        await _seed_minimal_chapter(db)
        db.add(ChapterTimelineState(chapter_id="c1", layout_version=3))
        await db.commit()
        with pytest.raises(TimelineLayoutConflictError):
            await replace_timeline_segments(
                db,
                "c1",
                ChapterTimelineWrite(layout_version=1, segments=[{"shot_id": "s1"}]),
            )
    await engine.dispose()


@pytest.mark.asyncio
async def test_replace_timeline_bumps_version_and_persists_positions() -> None:
    db, engine = await _make_session()
    async with db:
        await _seed_minimal_chapter(db)
        out = await replace_timeline_segments(
            db,
            "c1",
            ChapterTimelineWrite(segments=[{"shot_id": "s2"}, {"shot_id": "s1"}]),
        )
        assert out.layout_version == 2
        assert [x.shot_id for x in out.segments] == ["s2", "s1"]

        state = await db.get(ChapterTimelineState, "c1")
        assert state is not None
        assert state.layout_version == 2

        seg_res = await db.execute(
            select(ChapterTimelineSegment).where(ChapterTimelineSegment.chapter_id == "c1"),
        )
        assert len(list(seg_res.scalars().all())) == 2
    await engine.dispose()


@pytest.mark.asyncio
async def test_replace_timeline_rejects_trim_when_no_generated_video() -> None:
    db, engine = await _make_session()
    async with db:
        await _seed_minimal_chapter(db)
        with pytest.raises(ValueError, match="尚无成片"):
            await replace_timeline_segments(
                db,
                "c1",
                ChapterTimelineWrite(
                    segments=[
                        {"shot_id": "s1", "trim_start_ms": 0, "trim_end_ms": 1000},
                        {"shot_id": "s2"},
                    ],
                ),
            )
    await engine.dispose()


@pytest.mark.asyncio
async def test_replace_timeline_accepts_trim_when_video_present(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_probe(_storage_key: str) -> int:
        return 5000

    monkeypatch.setattr(
        "app.services.studio.chapter_timeline.probe_video_duration_ms_from_storage",
        _fake_probe,
    )

    db, engine = await _make_session()
    async with db:
        await _seed_minimal_chapter(db)
        db.add(
            FileItem(
                id="fv1",
                type=FileType.video,
                name="v",
                thumbnail="",
                tags=[],
                storage_key="key1",
            ),
        )
        s1 = await db.get(Shot, "s1")
        assert s1 is not None
        s1.generated_video_file_id = "fv1"
        await db.commit()

        out = await replace_timeline_segments(
            db,
            "c1",
            ChapterTimelineWrite(
                segments=[
                    {"shot_id": "s1", "trim_start_ms": 500, "trim_end_ms": 4500},
                    {"shot_id": "s2"},
                ],
            ),
        )
        row_s1 = next(x for x in out.segments if x.shot_id == "s1")
        assert row_s1.trim_start_ms == 500
        assert row_s1.trim_end_ms == 4500
    await engine.dispose()
