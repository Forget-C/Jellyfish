"""APIMart 图片能力声明与覆盖注册。

APIMart 的图片接口是 OpenAI 兼容的 ``/images/generations``，能力约束沿用同款默认值；
本模块存在的意义是让 ``register_image_model_capability(provider="apimart", ...)``
有独立落点，不与 OpenAI 的覆盖表互相污染。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.integrations.image_capabilities import ImageModelCapability

if TYPE_CHECKING:
    from app.core.contracts.image_generation import ImageGenerationInput

_APIMART_DEFAULT = ImageModelCapability(
    supports_seed=True,
    supports_watermark=True,
)

# key: 模型前缀（小写）
_APIMART_MODEL_OVERRIDES: dict[str, ImageModelCapability] = {}


def register_apimart_image_capability(*, model_prefix: str, capability: ImageModelCapability) -> None:
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _APIMART_MODEL_OVERRIDES[prefix] = capability


def clear_apimart_image_capability_overrides() -> None:
    _APIMART_MODEL_OVERRIDES.clear()


def _pick_override(model: str | None) -> ImageModelCapability | None:
    if not model:
        return None
    value = model.strip().lower()
    if not value:
        return None
    for prefix, cap in sorted(_APIMART_MODEL_OVERRIDES.items(), key=lambda item: len(item[0]), reverse=True):
        if value.startswith(prefix):
            return cap
    return None


def resolve_apimart_image_capability(model: str | None) -> ImageModelCapability:
    return _pick_override(model) or _APIMART_DEFAULT


def validate_apimart_image_options(input_: ImageGenerationInput) -> None:
    """APIMart 图片能力校验入口（避免调用侧传 provider 字面量）。"""
    from app.core.contracts.image_generation import ImageGenerationInput
    from app.core.integrations.image_capabilities import validate_image_options

    assert isinstance(input_, ImageGenerationInput)
    validate_image_options(provider="apimart", model=input_.model, input_=input_)
