"""可灵视频模型能力声明与覆盖注册。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.integrations.video_capabilities import VideoModelCapability

if TYPE_CHECKING:
    from app.core.contracts.video_generation import VideoGenerationInput

_KLING_VIDEO_RATIOS = {"16:9", "9:16", "1:1"}

# 文档将时长限定为 3 至 15 秒。
# 通用输入尚未承载 Omni 的原生音频和多镜头参数。
_KLING_TURBO = VideoModelCapability(
    supports_seed=False,
    supports_watermark=True,
    allowed_ratios=_KLING_VIDEO_RATIOS,
    default_ratio="16:9",
    min_seconds=3,
    max_seconds=15,
)
_KLING_OMNI = VideoModelCapability(
    supports_seed=False,
    supports_watermark=True,
    allowed_ratios=_KLING_VIDEO_RATIOS,
    default_ratio="16:9",
    min_seconds=3,
    max_seconds=15,
)

_KLING_MODEL_OVERRIDES: dict[str, VideoModelCapability] = {
    "kling-3.0-turbo": _KLING_TURBO,
    "kling-3.0": _KLING_OMNI,
}


def register_kling_video_capability(*, model_prefix: str, capability: VideoModelCapability) -> None:
    """注册按模型前缀匹配的可灵视频能力覆盖。"""
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _KLING_MODEL_OVERRIDES[prefix] = capability


def clear_kling_video_capability_overrides() -> None:
    """清除运行时覆盖并恢复可灵内置模型规则。"""
    _KLING_MODEL_OVERRIDES.clear()
    _KLING_MODEL_OVERRIDES.update(
        {
            "kling-3.0-turbo": _KLING_TURBO,
            "kling-3.0": _KLING_OMNI,
        }
    )


def resolve_kling_video_capability(model: str | None) -> VideoModelCapability:
    """按最长模型前缀选择可灵视频能力，未知模型使用公共交集。"""
    value = (model or "").strip().lower()
    overrides = sorted(
        _KLING_MODEL_OVERRIDES.items(),
        key=lambda item: len(item[0]),
        reverse=True,
    )
    for prefix, capability in overrides:
        if value.startswith(prefix):
            return capability
    return _KLING_TURBO


def validate_kling_video_options(input_: VideoGenerationInput) -> None:
    """在请求可灵前校验项目通用视频参数是否可映射。"""
    from app.core.integrations.video_capabilities import validate_video_options

    validate_video_options(provider="kling", model=input_.model, input_=input_)
