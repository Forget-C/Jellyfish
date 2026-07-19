"""Vidu 图片模型能力声明与覆盖注册。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.integrations.image_capabilities import ImageModelCapability

if TYPE_CHECKING:
    from app.core.contracts.image_generation import ImageGenerationInput

_VIDU_Q2_RATIO_SIZE_PROFILES = {
    ratio: {"standard": "1080p", "high": "2K"}
    for ratio in ("16:9", "9:16", "1:1", "3:4", "4:3", "21:9", "2:3", "3:2")
}
_VIDU_Q1_RATIO_SIZE_PROFILES = {
    ratio: {"standard": "1080p"}
    for ratio in ("16:9", "9:16", "1:1", "3:4", "4:3")
}

_VIDU_DEFAULT = ImageModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_sizes={"1080p", "2K", "4K"},
    supported_ratios=set(_VIDU_Q2_RATIO_SIZE_PROFILES),
    default_resolution_profile="standard",
    ratio_size_profiles=_VIDU_Q2_RATIO_SIZE_PROFILES,
    min_n=1,
    max_n=1,
)
_VIDU_Q1 = ImageModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_sizes={"1080p"},
    supported_ratios=set(_VIDU_Q1_RATIO_SIZE_PROFILES),
    default_resolution_profile="standard",
    ratio_size_profiles=_VIDU_Q1_RATIO_SIZE_PROFILES,
    min_n=1,
    max_n=1,
)

_VIDU_MODEL_OVERRIDES: dict[str, ImageModelCapability] = {"viduq1": _VIDU_Q1}


def register_vidu_image_capability(*, model_prefix: str, capability: ImageModelCapability) -> None:
    """注册按模型前缀匹配的 Vidu 图片能力覆盖。"""
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _VIDU_MODEL_OVERRIDES[prefix] = capability


def clear_vidu_image_capability_overrides() -> None:
    """清除测试或运行时新增的 Vidu 图片能力覆盖，保留内置模型规则。"""
    _VIDU_MODEL_OVERRIDES.clear()
    _VIDU_MODEL_OVERRIDES["viduq1"] = _VIDU_Q1


def resolve_vidu_image_capability(model: str | None) -> ImageModelCapability:
    """按最长模型前缀选择 Vidu 图片能力，未知模型采用 q2 兼容默认值。"""
    value = (model or "").strip().lower()
    for prefix, capability in sorted(_VIDU_MODEL_OVERRIDES.items(), key=lambda item: len(item[0]), reverse=True):
        if value.startswith(prefix):
            return capability
    return _VIDU_DEFAULT


def validate_vidu_image_options(input_: ImageGenerationInput) -> None:
    """在请求 Vidu 前校验项目通用图片参数是否可映射。"""
    from app.core.integrations.image_capabilities import validate_image_options

    validate_image_options(provider="vidu", model=input_.model, input_=input_)
