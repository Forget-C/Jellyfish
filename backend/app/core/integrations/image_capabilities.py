"""图片生成能力约束与参数校验辅助。"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.contracts.image_generation import ImageGenerationInput
from app.core.contracts.provider import ProviderKey

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
