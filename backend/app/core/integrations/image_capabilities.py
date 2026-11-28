"""图片生成能力约束与参数校验辅助。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeVar

from app.core.contracts.image_generation import ImageGenerationInput
from app.core.contracts.model_capabilities import ImageModeDeclaration, ImageOperationMode
from app.core.contracts.provider import ProviderKey
from app.core.contracts.model_provider import ModelProviderConfigurationError

_ImageInput = TypeVar("_ImageInput", bound=ImageGenerationInput)

_IMAGE_MODES: dict[ProviderKey, tuple[ImageOperationMode, ...]] = {
    "openai": ("text_to_image", "edit"),
    "volcengine": ("text_to_image", "reference_image"),
    "vidu": ("text_to_image", "reference_image"),
    "kling": ("text_to_image", "reference_image"),
}


def resolve_image_mode(provider: ProviderKey, reference_count: int) -> ImageOperationMode:
    """选择适配器对当前参考图组合使用的操作。"""
    if not reference_count:
        return "text_to_image"
    return "edit" if provider == "openai" else "reference_image"


def describe_image_modes(
    provider: ProviderKey, model: str, declared: dict[ImageOperationMode, ImageModeDeclaration],
) -> dict[ImageOperationMode, ImageModeDeclaration]:
    """按操作查询内置适配器范围与管理员声明的交集。"""
    modes = _IMAGE_MODES.get(provider, ())
    if not modes:
        return {}
    capability = resolve_image_capability(provider=provider, model=model)
    result = {}
    for mode in modes:
        rule = declared.get(mode, ImageModeDeclaration())
        result[mode] = ImageModeDeclaration(
            supported=rule.supported is not False,
            sizes=_intersect_options(rule.sizes, capability.allowed_sizes),
            ratios=_intersect_options(rule.ratios, capability.supported_ratios),
            resolution_profiles=_intersect_options(rule.resolution_profiles, {"standard", "high"}),
            max_outputs=min(rule.max_outputs or 10, capability.max_n or 10),
            max_reference_images=_minimum(rule.max_reference_images, capability.max_reference_images),
            seed=capability.supports_seed and provider != "openai" and rule.seed is not False,
            watermark=capability.supports_watermark and rule.watermark is not False,
        )
    return result


def _minimum(first: int | None, second: int | None) -> int | None:
    values = [item for item in (first, second) if item is not None]
    return min(values) if values else None


def _intersect_options(declared: list[str] | None, available: set[str] | None) -> list[str] | None:
    if available is None:
        return declared
    return sorted(available if declared is None else available.intersection(declared))


def validate_image_declaration(
    provider: ProviderKey,
    modes: dict[ImageOperationMode, ImageModeDeclaration],
    *,
    references: int,
    ratio: str | None,
    resolution_profile: str | None,
    size: str | None,
    outputs: int,
    seed: int | None,
    watermark: bool | None,
) -> None:
    """校验请求是否超出所选配置对当前操作的声明。"""
    available = _IMAGE_MODES.get(provider)
    if available is None:
        raise ValueError(f"Unsupported image provider: {provider!r}")
    mode = resolve_image_mode(provider, references)
    limits = modes.get(mode)
    if limits is None:
        return
    if limits.supported is False:
        raise ValueError(f"image mode is unsupported: {mode}")
    for name, value, allowed in (
        ("target_ratio", ratio, limits.ratios),
        ("resolution_profile", resolution_profile, limits.resolution_profiles),
        ("size", size, limits.sizes),
    ):
        if value is not None and allowed is not None and value not in allowed:
            raise ValueError(f"{name} is outside the declared image options")
    if limits.max_outputs is not None and outputs > limits.max_outputs:
        raise ValueError("count exceeds the declared image limit")
    if limits.max_reference_images is not None and references > limits.max_reference_images:
        raise ValueError("reference count exceeds the declared image limit")
    if seed is not None and limits.seed is False:
        raise ValueError("seed is unsupported for this image mode")
    if watermark is not None and limits.watermark is False:
        raise ValueError("watermark is unsupported for this image mode")

DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP: dict[str, dict[str, str]] = {
    "16:9": {"standard": "1792x1024", "high": "2048x1152"},
    "4:3": {"standard": "1536x1152", "high": "2048x1536"},
    "1:1": {"standard": "1024x1024", "high": "1536x1536"},
    "3:2": {"standard": "1536x1024", "high": "2048x1365"},
    "2:3": {"standard": "1024x1536", "high": "1365x2048"},
    "3:4": {"standard": "1152x1536", "high": "1536x2048"},
    "9:16": {"standard": "1024x1792", "high": "1152x2048"},
    "21:9": {"standard": "2048x896", "high": "2304x1024"},
}


@dataclass(frozen=True, slots=True)
class ImageModelCapability:
    """供应商/模型图片能力约束。"""

    supports_seed: bool = True
    supports_watermark: bool = True
    allowed_sizes: set[str] | None = None
    supported_ratios: set[str] | None = None
    default_resolution_profile: str | None = "standard"
    ratio_size_profiles: dict[str, dict[str, str]] | None = None
    min_n: int | None = 1
    max_n: int | None = 10
    max_reference_images: int | None = None
    supports_duplicate_reference_images: bool = True


def register_image_model_capability(
    *,
    provider: ProviderKey,
    model_prefix: str,
    capability: ImageModelCapability,
) -> None:
    """兼容入口：注册模型能力覆盖（按前缀匹配，大小写不敏感）。"""
    if provider == "openai":
        from app.core.integrations.openai.image_capabilities import register_openai_image_capability

        register_openai_image_capability(model_prefix=model_prefix, capability=capability)
        return
    if provider == "vidu":
        from app.core.integrations.vidu.image_capabilities import register_vidu_image_capability

        register_vidu_image_capability(model_prefix=model_prefix, capability=capability)
        return
    if provider == "kling":
        from app.core.integrations.kling.image_capabilities import register_kling_image_capability

        register_kling_image_capability(model_prefix=model_prefix, capability=capability)
        return
    if provider != "volcengine":
        raise ModelProviderConfigurationError(f"Unsupported image provider: {provider!r}")
    from app.core.integrations.volcengine.image_capabilities import register_volcengine_image_capability

    register_volcengine_image_capability(model_prefix=model_prefix, capability=capability)


def clear_image_model_capability_overrides(*, provider: ProviderKey | None = None) -> None:
    """兼容入口：清空能力覆盖；供测试或重置场景使用。"""
    from app.core.integrations.openai.image_capabilities import clear_openai_image_capability_overrides
    from app.core.integrations.vidu.image_capabilities import clear_vidu_image_capability_overrides
    from app.core.integrations.volcengine.image_capabilities import clear_volcengine_image_capability_overrides
    from app.core.integrations.kling.image_capabilities import clear_kling_image_capability_overrides

    if provider is None:
        clear_openai_image_capability_overrides()
        clear_volcengine_image_capability_overrides()
        clear_vidu_image_capability_overrides()
        clear_kling_image_capability_overrides()
        return
    if provider == "openai":
        clear_openai_image_capability_overrides()
        return
    if provider == "vidu":
        clear_vidu_image_capability_overrides()
        return
    if provider == "kling":
        clear_kling_image_capability_overrides()
        return
    clear_volcengine_image_capability_overrides()


def resolve_image_capability(*, provider: ProviderKey, model: str | None) -> ImageModelCapability:
    if provider == "openai":
        from app.core.integrations.openai.image_capabilities import resolve_openai_image_capability

        return resolve_openai_image_capability(model)
    if provider == "vidu":
        from app.core.integrations.vidu.image_capabilities import resolve_vidu_image_capability

        return resolve_vidu_image_capability(model)
    if provider == "kling":
        from app.core.integrations.kling.image_capabilities import resolve_kling_image_capability

        return resolve_kling_image_capability(model)
    if provider != "volcengine":
        raise ModelProviderConfigurationError(f"Unsupported image provider: {provider!r}")
    from app.core.integrations.volcengine.image_capabilities import resolve_volcengine_image_capability

    return resolve_volcengine_image_capability(model)


def resolve_image_size(
    *,
    provider: ProviderKey,
    model: str | None,
    purpose: str,
    target_ratio: str | None,
    resolution_profile: str | None,
    requested_size: str | None,
) -> str | None:
    """解析图片最终 size。

    普通图片任务优先保留显式传入的 requested_size；
    视频参考帧场景则优先根据 target_ratio + resolution_profile 从 capability 推导，
    以保证关键帧与目标视频画幅保持一致。
    """
    if purpose != "video_reference":
        return requested_size

    ratio = (target_ratio or "").strip()
    if not ratio:
        return requested_size

    cap = resolve_image_capability(provider=provider, model=model)
    if cap.supported_ratios is not None and ratio not in cap.supported_ratios:
        raise ValueError(
            f"Unsupported target_ratio for provider={provider} model={model or '<default>'}: {ratio}. "
            f"Allowed: {sorted(cap.supported_ratios)}"
        )

    profile = (resolution_profile or cap.default_resolution_profile or "standard").strip() or "standard"
    profiles = cap.ratio_size_profiles or DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP
    size = profiles.get(ratio, {}).get(profile)
    if size:
        return size

    fallback_profiles = DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP.get(ratio, {})
    return fallback_profiles.get(profile) or fallback_profiles.get("standard") or requested_size


def validate_image_options(
    *,
    provider: ProviderKey,
    model: str | None,
    input_: ImageGenerationInput,
) -> None:
    cap = resolve_image_capability(provider=provider, model=model)
    if input_.size and cap.allowed_sizes is not None and input_.size not in cap.allowed_sizes:
        raise ValueError(
            f"Unsupported size for provider={provider} model={model or '<default>'}: {input_.size}. "
            f"Allowed: {sorted(cap.allowed_sizes)}"
        )
    if cap.min_n is not None and input_.n < cap.min_n:
        raise ValueError(f"n must be >= {cap.min_n}")
    if cap.max_n is not None and input_.n > cap.max_n:
        raise ValueError(f"n must be <= {cap.max_n}")
    if input_.seed is not None and not cap.supports_seed:
        raise ValueError(f"seed is not supported by provider={provider} model={model or '<default>'}")
    if input_.watermark is not None and not cap.supports_watermark:
        raise ValueError(f"watermark is not supported by provider={provider} model={model or '<default>'}")


def prepare_image_options(
    provider: ProviderKey,
    input_: _ImageInput,
    modes: dict[ImageOperationMode, ImageModeDeclaration] | None = None,
) -> _ImageInput:
    """准备实际发送的 size，并在供应商和模型声明的交集内校验请求。"""
    size = resolve_image_size(
        provider=provider, model=input_.model, purpose=input_.purpose, target_ratio=input_.target_ratio,
        resolution_profile=input_.resolution_profile, requested_size=input_.size,
    )
    prepared = input_.model_copy(update={"size": size})
    validate_image_options(provider=provider, model=prepared.model, input_=prepared)
    validate_image_declaration(
        provider, modes or {}, references=len(prepared.images), ratio=prepared.target_ratio,
        resolution_profile=prepared.resolution_profile, size=size, outputs=prepared.n,
        seed=prepared.seed, watermark=prepared.watermark,
    )
    if provider == "openai" and prepared.seed is not None:
        raise ValueError("seed is not supported by the OpenAI image adapter")
    return prepared
