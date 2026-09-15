"""file_usages 服务：scope 条件（轻量单测）。"""

from __future__ import annotations

from app.services.studio import file_usages as fu


def test_scope_filters_empty_when_no_titles() -> None:
    assert fu._scope_filters(project_id="p1", chapter_title=None) == []


def test_scope_filters_chapter_only() -> None:
    conds = fu._scope_filters(project_id="p1", chapter_title="  第一章 ")
    assert len(conds) == 1
