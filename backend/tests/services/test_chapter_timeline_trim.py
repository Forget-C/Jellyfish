"""chapter_timeline_trim 纯函数单测。"""

from __future__ import annotations

import pytest

from app.services.studio.chapter_timeline_trim import (
    is_lossless_compatible_trim,
    resolve_effective_trim_ms,
    trim_seconds_for_ffmpeg,
    validate_effective_trim_ms,
)


def test_resolve_full_when_both_none() -> None:
    assert resolve_effective_trim_ms(5000, None, None) is None


def test_resolve_partial_defaults() -> None:
    assert resolve_effective_trim_ms(10_000, 1000, None) == (1000, 10_000)
    assert resolve_effective_trim_ms(10_000, None, 8000) == (0, 8000)


def test_validate_effective_trim_ok() -> None:
    validate_effective_trim_ms(5000, (0, 5000), shot_id="s1")


def test_validate_rejects_inverted_range() -> None:
    with pytest.raises(ValueError, match="入点必须小于出点"):
        validate_effective_trim_ms(5000, (3000, 1000), shot_id="s1")


def test_trim_seconds_full_uses_float_duration() -> None:
    start_s, end_s = trim_seconds_for_ffmpeg(10.026, None, None)
    assert start_s == 0.0
    assert abs(end_s - 10.026) < 1e-9


def test_trim_seconds_with_ms() -> None:
    start_s, end_s = trim_seconds_for_ffmpeg(10.0, 500, 2500)
    assert start_s == 0.5
    assert end_s == 2.5


def test_lossless_compatible() -> None:
    assert is_lossless_compatible_trim(1000, None, None) is True
    assert is_lossless_compatible_trim(1000, 0, 1000) is True
    assert is_lossless_compatible_trim(1000, 100, 900) is False
