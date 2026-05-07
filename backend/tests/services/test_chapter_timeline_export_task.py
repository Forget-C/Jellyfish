"""章节时间线导出 Runner 中的纯函数单测。"""

from __future__ import annotations

import pytest

from app.services.studio.chapter_timeline_export_task import build_uniform_transcode_concat_filter


def test_build_uniform_transcode_concat_includes_audio_concat() -> None:
    filt = build_uniform_transcode_concat_filter([(0.0, 3.0, True), (0.0, 2.5, False)])
    assert "concat=n=2:v=1:a=1" in filt
    assert "[outa]" in filt
    assert "anullsrc=" in filt
    assert "atrim=end=2.500000" in filt
    assert "[0:a:0]atrim=" in filt
    assert "trim=start=" in filt


def test_build_uniform_transcode_concat_rejects_empty() -> None:
    with pytest.raises(ValueError, match="empty"):
        build_uniform_transcode_concat_filter([])
