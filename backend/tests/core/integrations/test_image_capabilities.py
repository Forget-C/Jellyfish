"""图片能力映射单测。"""

from __future__ import annotations

import pytest

from app.core.contracts.image_generation import ImageGenerationInput
from app.core.integrations.image_capabilities import (
    ImageModelCapability,
    clear_image_model_capability_overrides,
    register_image_model_capability,
    resolve_image_capability,
    resolve_image_size,
    validate_image_options,
)


def test_resolve_image_capability_prefers_longest_prefix() -> None:
    clear_image_model_capability_overrides(provider="openai")
    register_image_model_capability(
        provider="openai",
        model_prefix="gpt-image",
        capability=ImageModelCapability(supports_seed=False),
    )
    register_image_model_capability(
        provider="openai",
        model_prefix="gpt-image-1.5",
        capability=ImageModelCapability(supports_seed=True, supports_watermark=False),
    )
    try:
        cap = resolve_image_capability(provider="openai", model="gpt-image-1.5-pro")
        assert cap.supports_seed is True
        assert cap.supports_watermark is False
    finally:
        clear_image_model_capability_overrides(provider="openai")


def test_validate_image_options_rejects_capability_mismatch() -> None:
    clear_image_model_capability_overrides(provider="volcengine")
    register_image_model_capability(
        provider="volcengine",
        model_prefix="seedream",
        capability=ImageModelCapability(supports_watermark=False),
    )
    try:
        inp = ImageGenerationInput(prompt="test", model="seedream-v3", watermark=True)
        with pytest.raises(ValueError) as exc_info:
            validate_image_options(provider="volcengine", model=inp.model, input_=inp)
        assert "watermark is not supported" in str(exc_info.value)
    finally:
        clear_image_model_capability_overrides(provider="volcengine")


def test_resolve_image_size_uses_video_reference_ratio_profile() -> None:
    clear_image_model_capability_overrides(provider="openai")
    register_image_model_capability(
        provider="openai",
        model_prefix="gpt-image-video-ref",
        capability=ImageModelCapability(
            supported_ratios={"16:9"},
            ratio_size_profiles={"16:9": {"standard": "1792x1024"}},
        ),
    )
    try:
        size = resolve_image_size(
            provider="openai",
            model="gpt-image-video-ref-1",
            purpose="video_reference",
            target_ratio="16:9",
            resolution_profile="standard",
            requested_size=None,
        )
        assert size == "1792x1024"
    finally:
        clear_image_model_capability_overrides(provider="openai")


def test_resolve_image_size_uses_volcengine_builtin_2k_3k_profiles() -> None:
    size_2k = resolve_image_size(
        provider="volcengine",
        model="seedream-v3",
        purpose="video_reference",
        target_ratio="9:16",
        resolution_profile="standard",
        requested_size=None,
    )
    size_3k = resolve_image_size(
        provider="volcengine",
        model="seedream-v3",
        purpose="video_reference",
        target_ratio="21:9",
        resolution_profile="high",
        requested_size=None,
    )
    assert size_2k == "1600x2848"
    assert size_3k == "4704x2016"


def test_dreamapi_image_capability_does_not_fall_through_to_volcengine() -> None:
    capability = resolve_image_capability(provider="dreamapi", model="seedream-5.0-pro")

    assert capability.supports_watermark is False
    assert capability.max_n == 1
