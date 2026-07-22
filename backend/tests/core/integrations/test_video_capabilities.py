"""视频能力映射单测。"""

from __future__ import annotations

import pytest

from app.core.contracts.video_generation import VideoFrameReferences, VideoGenerationInput, VideoSubjectReference
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


def test_vidu_subject_video_is_limited_to_q2_pro_and_conflicts_with_frames() -> None:
    """Vidu 主体视频仅 q2-pro 支持，且主体与构图帧不可混用。"""
    subject = VideoSubjectReference(name="hero", videos=["https://cdn.example/hero.mp4"])
    q2_pro = VideoGenerationInput(
        prompt="@hero walks into the room",
        model="viduq2-pro",
        ratio="16:9",
        subject_references=[subject],
    )
    validate_video_options(provider="vidu", model=q2_pro.model, input_=q2_pro)

    q2 = q2_pro.model_copy(update={"model": "viduq2"})
    with pytest.raises(ValueError, match="subject video references are not supported"):
        validate_video_options(provider="vidu", model=q2.model, input_=q2)

    conflict = q2_pro.model_copy(update={"frame_references": VideoFrameReferences(first_frame="frame")})
    with pytest.raises(ValueError, match="cannot be combined with frame references"):
        validate_video_options(provider="vidu", model=conflict.model, input_=conflict)
