"""DreamAPI video model capabilities from the local task contract and API limits."""

from __future__ import annotations

from app.core.integrations.video_capabilities import VideoModelCapability

_DREAMVIDEO = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_ratios={"16:9", "4:3", "1:1", "3:4", "9:16"},
    default_ratio="16:9",
    min_seconds=3,
    max_seconds=15,
)
_WAN_21 = VideoModelCapability(
    supports_seed=False,
    supports_watermark=False,
    allowed_ratios={"16:9"},
    default_ratio="16:9",
    min_seconds=5,
    max_seconds=5,
)
_SEEDANCE_RATIOS = {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}
_SEEDANCE_20 = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_ratios=set(_SEEDANCE_RATIOS),
    default_ratio="16:9",
    min_seconds=4,
    max_seconds=15,
)
_SEEDANCE_25 = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_ratios=set(_SEEDANCE_RATIOS),
    default_ratio="16:9",
    min_seconds=4,
    max_seconds=30,
)
_DEFAULT = VideoModelCapability(supports_seed=False, supports_watermark=False)
_OVERRIDES: dict[str, VideoModelCapability] = {
    "dreamvideo-3": _DREAMVIDEO,
    "wan2.1": _WAN_21,
    "wan-2.1": _WAN_21,
    "seedance-2.0-mini": _SEEDANCE_20,
    "seedance-2.0": _SEEDANCE_20,
    "seedance-2.5": _SEEDANCE_25,
}
_DEFAULT_OVERRIDES = dict(_OVERRIDES)


def register_dreamapi_video_capability(*, model_prefix: str, capability: VideoModelCapability) -> None:
    """Register an administrator-defined DreamAPI video model override."""
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _OVERRIDES[prefix] = capability


def clear_dreamapi_video_capability_overrides() -> None:
    """Restore built-in DreamAPI video capabilities after tests or reconfiguration."""
    _OVERRIDES.clear()
    _OVERRIDES.update(_DEFAULT_OVERRIDES)


def resolve_dreamapi_video_capability(model: str | None) -> VideoModelCapability:
    """Resolve the longest matching DreamAPI video model prefix."""
    normalized = (model or "").strip().lower().replace("_", "-").replace(" ", "-")
    for prefix, capability in sorted(_OVERRIDES.items(), key=lambda item: len(item[0]), reverse=True):
        if normalized.startswith(prefix):
            return capability
    return _DEFAULT
