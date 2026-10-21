"""DreamAPI image model defaults, including reference-frame size profiles."""

from __future__ import annotations

from app.core.integrations.image_capabilities import (
    DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP,
    ImageModelCapability,
)

_DEFAULT = ImageModelCapability(supports_seed=False, supports_watermark=False)
_SINGLE_IMAGE_OUTPUT = ImageModelCapability(
    supports_seed=False,
    supports_watermark=False,
    max_n=1,
)
_SEEDREAM_VIDEO_REFERENCE_PROFILES = {
    "16:9": {"standard": "2560x1440", "high": "3072x1728"},
    "4:3": {"standard": "2304x1728", "high": "3072x2304"},
    "1:1": {"standard": "2048x2048", "high": "3072x3072"},
    "3:2": {"standard": "2432x1616", "high": "3200x2112"},
    "2:3": {"standard": "1616x2432", "high": "2112x3200"},
    "3:4": {"standard": "1728x2304", "high": "2304x3072"},
    "9:16": {"standard": "1440x2560", "high": "1728x3072"},
    "21:9": {"standard": "3072x1312", "high": "3584x1536"},
}
_FLUX_VIDEO_REFERENCE_PROFILES = {
    "16:9": {"standard": "1600x896", "high": "1600x896"},
    "4:3": {"standard": "1536x1152", "high": "1536x1152"},
    "1:1": {"standard": "1024x1024", "high": "1536x1536"},
    "3:2": {"standard": "1536x1024", "high": "1536x1024"},
    "2:3": {"standard": "1024x1536", "high": "1024x1536"},
    "3:4": {"standard": "1152x1536", "high": "1152x1536"},
    "9:16": {"standard": "896x1600", "high": "896x1600"},
    "21:9": {"standard": "1600x688", "high": "1600x688"},
}
_SEEDREAM_STANDARD = ImageModelCapability(
    supports_seed=True,
    supports_watermark=False,
    ratio_size_profiles=DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP,
    min_n=1,
    max_n=1,
)
_SEEDREAM_LARGE = ImageModelCapability(
    supports_seed=True,
    supports_watermark=False,
    ratio_size_profiles=_SEEDREAM_VIDEO_REFERENCE_PROFILES,
    min_n=1,
    max_n=1,
)
_FLUX = ImageModelCapability(
    supports_seed=True,
    supports_watermark=False,
    ratio_size_profiles=_FLUX_VIDEO_REFERENCE_PROFILES,
)
_GPT_IMAGE = ImageModelCapability(
    supports_seed=False,
    supports_watermark=False,
)

_OVERRIDES: dict[str, ImageModelCapability] = {
    "seedream-5.0-pro": _SEEDREAM_STANDARD,
    "seedream-5.0-lite": _SEEDREAM_LARGE,
    "seedream-4.5": _SEEDREAM_LARGE,
    "seedream-4.0": _SEEDREAM_STANDARD,
    "seedream": _SEEDREAM_STANDARD,
    "flux": _FLUX,
    "dreamimage": _SINGLE_IMAGE_OUTPUT,
    "nano-banana": _SINGLE_IMAGE_OUTPUT,
    "gemini-": _SINGLE_IMAGE_OUTPUT,
    "gpt-image-2.5": _GPT_IMAGE,
    "gpt-image": _GPT_IMAGE,
    "colorize": _SINGLE_IMAGE_OUTPUT,
    "enhance": _SINGLE_IMAGE_OUTPUT,
    "remove-background": _SINGLE_IMAGE_OUTPUT,
    "remove-bg": _SINGLE_IMAGE_OUTPUT,
    "swap-face": _SINGLE_IMAGE_OUTPUT,
    "virtual-try-on": _SINGLE_IMAGE_OUTPUT,
    "try-on": _SINGLE_IMAGE_OUTPUT,
}
_DEFAULT_OVERRIDES = dict(_OVERRIDES)


def register_dreamapi_image_capability(*, model_prefix: str, capability: ImageModelCapability) -> None:
    """Register an administrator-defined DreamAPI image model override."""
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _OVERRIDES[prefix] = capability


def clear_dreamapi_image_capability_overrides() -> None:
    """Restore built-in DreamAPI image capabilities after tests or reconfiguration."""
    _OVERRIDES.clear()
    _OVERRIDES.update(_DEFAULT_OVERRIDES)


def resolve_dreamapi_image_capability(model: str | None) -> ImageModelCapability:
    """Resolve the longest matching DreamAPI image model prefix."""
    normalized = (model or "").strip().lower().replace("_", "-")
    for prefix, capability in sorted(_OVERRIDES.items(), key=lambda item: len(item[0]), reverse=True):
        if normalized.startswith(prefix):
            return capability
    return _DEFAULT
