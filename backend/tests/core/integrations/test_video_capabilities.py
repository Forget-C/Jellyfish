"""视频能力映射单测。"""

from __future__ import annotations

import pytest

from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.video_capabilities import (
    VideoModelCapability,
    clear_video_model_capability_overrides,
    infer_ratio_from_size,
    register_video_model_capability,
    resolve_video_capability,
    validate_video_options,
)


def test_infer_ratio_from_size_supports_ratio_and_resolution() -> None:
    assert infer_ratio_from_size("16:9") == "16:9"
    assert infer_ratio_from_size("1920x1080") == "16:9"
    assert infer_ratio_from_size("720x1280") == "9:16"
    assert infer_ratio_from_size("abc") is None


def test_resolve_video_capability_prefers_longest_prefix() -> None:
    clear_video_model_capability_overrides(provider="openai")
    register_video_model_capability(
        provider="openai",
        model_prefix="gpt-video",
        capability=VideoModelCapability(supports_seed=False),
    )
    register_video_model_capability(
        provider="openai",
        model_prefix="gpt-video-pro",
        capability=VideoModelCapability(supports_seed=True, supports_watermark=False),
    )
    try:
        cap = resolve_video_capability(provider="openai", model="gpt-video-pro-1")
        assert cap.supports_seed is True
        assert cap.supports_watermark is False
    finally:
        clear_video_model_capability_overrides(provider="openai")


def test_validate_video_options_rejects_capability_mismatch() -> None:
    clear_video_model_capability_overrides(provider="volcengine")
    register_video_model_capability(
        provider="volcengine",
        model_prefix="seedream-video",
        capability=VideoModelCapability(supports_seed=False),
    )
    try:
        inp = VideoGenerationInput(prompt="test", model="seedream-video-v1", ratio="16:9", seed=7)
        with pytest.raises(ValueError) as exc_info:
            validate_video_options(provider="volcengine", model=inp.model, input_=inp)
        assert "seed is not supported" in str(exc_info.value)
    finally:
        clear_video_model_capability_overrides(provider="volcengine")


@pytest.mark.parametrize(
    "value",
    [
        "",
        "   ",
        "1920x",
        "x1080",
        "19.2x10.8",
        "0x100",
        "100x0",
        "-16x9",
        "1000x37",
        "5:3",
        None,
    ],
)
def test_infer_ratio_from_size_rejects_invalid_input(value: str | None) -> None:
    """空白、格式非法、零/负尺寸与不受支持的比例一律返回 None。"""
    assert infer_ratio_from_size(value) is None


@pytest.mark.parametrize(
    "value,expected",
    [
        (" 16:9 ", "16:9"),
        ("1920X1080", "16:9"),
        ("1920 x 1080", "16:9"),
        ("1024x1024", "1:1"),
        ("768x1024", "3:4"),
        ("1024x768", "4:3"),
    ],
)
def test_infer_ratio_from_size_tolerates_whitespace_and_case(value: str, expected: str) -> None:
    """容忍首尾空白、内部空格与大写 X；约简后须落在 ALLOWED_RATIOS 内。"""
    assert infer_ratio_from_size(value) == expected
