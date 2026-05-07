"""章节时间线 ORM 注册烟雾测试（metadata 含表定义）。"""

from __future__ import annotations

import importlib

from app.core.db import Base


def test_chapter_timeline_models_registered_in_metadata() -> None:
    importlib.import_module("app.models.studio")

    table_names = Base.metadata.tables.keys()
    assert "chapter_timeline_states" in table_names
    assert "chapter_timeline_segments" in table_names


def test_chapter_timeline_models_importable_from_studio_package() -> None:
    from app.models.studio import ChapterTimelineSegment, ChapterTimelineState

    assert ChapterTimelineState.__tablename__ == "chapter_timeline_states"
    assert ChapterTimelineSegment.__tablename__ == "chapter_timeline_segments"
