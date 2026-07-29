"""GET /files 的 chapter_id / usage_kind 附加过滤（Step 6 最小检索契约调整）。

背景：EP001 工作台需要按章节取出该章节的 zh-Hant 字幕产物。既有实现只支持
``chapter_title``（标题精确匹配，标题并不唯一）且没有 ``usage_kind`` 过滤，
因此新增两个**可选**查询参数；省略时行为与既有实现完全一致。
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.db import Base
from app.models.studio import Chapter, FileItem, FileUsage, Project
from app.models.types import (
    ChapterStatus,
    FileType,
    FileUsageKind,
    ProjectStyle,
    ProjectVisualStyle,
)
from app.services.studio.file_usages import list_files_by_scope_paginated


async def _make_sessionmaker():
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    import app.models.llm  # noqa: F401
    import app.models.studio  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed(session_factory) -> dict:
    """两个同名章节各挂一个字幕文件，外加一个图片文件，用于区分过滤效果。"""
    ids: dict = {}
    async with session_factory() as db:
        project = Project(
            id="p1",
            name="Series",
            style=ProjectStyle.anime_3d,
            visual_style=ProjectVisualStyle.anime,
        )
        db.add(project)

        # 两个章节标题**相同** —— 正是 chapter_title 无法区分的场景。
        for key in ("a", "b"):
            chapter = Chapter(
                id=f"ch-{key}",
                project_id="p1",
                index=1 if key == "a" else 2,
                title="Same Title",
                summary="",
                raw_text="",
                condensed_text="",
                storyboard_count=0,
                status=ChapterStatus.draft,
            )
            db.add(chapter)
            subtitle = FileItem(
                id=f"file-sub-{key}",
                type=FileType.subtitle,
                name=f"EP-{key}.zh-Hant.vtt",
                thumbnail="",
                tags=[],
                storage_key=f"cas/subtitles/p1/EP-{key}/zh-Hant.vtt",
            )
            db.add(subtitle)
            db.add(
                FileUsage(
                    file_id=subtitle.id,
                    project_id="p1",
                    chapter_id=chapter.id,
                    shot_id=None,
                    usage_kind=FileUsageKind.subtitle,
                    source_ref=f"cas:EP-{key}:zh-Hant",
                )
            )
            ids[key] = chapter.id

        # 同章节下的另一类文件：不应被 usage_kind=subtitle 命中。
        image = FileItem(
            id="file-img",
            type=FileType.image,
            name="frame.png",
            thumbnail="",
            tags=[],
            storage_key="files/frame.png",
        )
        db.add(image)
        db.add(
            FileUsage(
                file_id=image.id,
                project_id="p1",
                chapter_id="ch-a",
                shot_id=None,
                usage_kind=FileUsageKind.shot_frame,
                source_ref=str(uuid.uuid4()),
            )
        )
        await db.commit()
    return ids


def test_chapter_id_filter_distinguishes_same_titled_chapters() -> None:
    """chapter_id 能区分标题相同的两个章节；chapter_title 做不到。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            await _seed(session_factory)
            async with session_factory() as db:
                by_id, total_by_id = await list_files_by_scope_paginated(
                    db, project_id="p1", chapter_id="ch-a", usage_kind="subtitle"
                )
                by_title, total_by_title = await list_files_by_scope_paginated(
                    db, project_id="p1", chapter_title="Same Title", usage_kind="subtitle"
                )

            assert total_by_id == 1
            assert [f.id for f in by_id] == ["file-sub-a"]
            # 标题相同 → 两个章节的字幕都被命中，无法定位
            assert total_by_title == 2
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_usage_kind_filter_excludes_other_kinds() -> None:
    """usage_kind 只返回该用途的文件。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            await _seed(session_factory)
            async with session_factory() as db:
                subs, sub_total = await list_files_by_scope_paginated(
                    db, project_id="p1", chapter_id="ch-a", usage_kind="subtitle"
                )
                frames, frame_total = await list_files_by_scope_paginated(
                    db, project_id="p1", chapter_id="ch-a", usage_kind="shot_frame"
                )
                everything, all_total = await list_files_by_scope_paginated(
                    db, project_id="p1", chapter_id="ch-a"
                )

            assert [f.id for f in subs] == ["file-sub-a"] and sub_total == 1
            assert [f.id for f in frames] == ["file-img"] and frame_total == 1
            # 不带 usage_kind → 该章节下两类文件都返回（既有行为不变）
            assert all_total == 2
            assert {f.id for f in everything} == {"file-sub-a", "file-img"}
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_omitting_new_filters_preserves_existing_behaviour() -> None:
    """两个新参数都省略时，结果与既有 project-only 查询一致。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            await _seed(session_factory)
            async with session_factory() as db:
                items, total = await list_files_by_scope_paginated(db, project_id="p1")
            assert total == 3
            assert {f.id for f in items} == {"file-sub-a", "file-sub-b", "file-img"}
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_unknown_chapter_id_returns_empty() -> None:
    """未知章节返回空集而不是报错。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            await _seed(session_factory)
            async with session_factory() as db:
                items, total = await list_files_by_scope_paginated(
                    db, project_id="p1", chapter_id="ch-missing"
                )
            assert items == [] and total == 0
        finally:
            await engine.dispose()

    asyncio.run(_run())
