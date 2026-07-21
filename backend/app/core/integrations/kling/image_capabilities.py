"""可灵图片模型能力声明与覆盖注册。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.integrations.image_capabilities import ImageModelCapability

if TYPE_CHECKING:
    from app.core.contracts.image_generation import ImageGenerationInput

_KLING_IMAGE_RATIO_SIZE_PROFILES = {
    ratio: {"standard": "1k", "high": "2k"}
    for ratio in ("16:9", "9:16", "1:1", "3:4", "4:3")
}
_KLING_IMAGE_3_0 = ImageModelCapability(
    supports_seed=False,
    supports_watermark=True,
    allowed_sizes={"1k", "2k"},
    supported_ratios=set(_KLING_IMAGE_RATIO_SIZE_PROFILES),
    default_resolution_profile="standard",
    ratio_size_profiles=_KLING_IMAGE_RATIO_SIZE_PROFILES,
    min_n=1,
    max_n=9,
)

_KLING_MODEL_OVERRIDES: dict[str, ImageModelCapability] = {"kling-v3": _KLING_IMAGE_3_0}


def register_kling_image_capability(*, model_prefix: str, capability: ImageModelCapability) -> None:
    """注册按模型前缀匹配的可灵图片能力覆盖。"""
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _KLING_MODEL_OVERRIDES[prefix] = capability


def clear_kling_image_capability_overrides() -> None:
    """清除运行时覆盖并恢复可灵内置模型规则。"""
    _KLING_MODEL_OVERRIDES.clear()
    _KLING_MODEL_OVERRIDES["kling-v3"] = _KLING_IMAGE_3_0


def resolve_kling_image_capability(model: str | None) -> ImageModelCapability:
    """按最长模型前缀选择可灵图片能力。

    未知模型使用 Image 3.0 公共约束。
    """
    value = (model or "").strip().lower()
    overrides = sorted(
        _KLING_MODEL_OVERRIDES.items(),
        key=lambda item: len(item[0]),
        reverse=True,
    )
    for prefix, capability in overrides:
        if value.startswith(prefix):
            return capability
    return _KLING_IMAGE_3_0


def validate_kling_image_options(input_: ImageGenerationInput) -> None:
    """在请求可灵前校验项目通用图片参数是否可映射。"""
    from app.core.integrations.image_capabilities import validate_image_options

    validate_image_options(provider="kling", model=input_.model, input_=input_)
