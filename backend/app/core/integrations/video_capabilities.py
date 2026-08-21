"""视频生成能力约束与参数映射辅助。"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.contracts.provider import ProviderKey
from app.core.contracts.video_generation import VideoGenerationInput, VideoRatio

ALLOWED_RATIOS = {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a


_RATIO_ASPECTS: dict[tuple[int, int], str] = {}
_DIMENSION_ASPECTS: dict[tuple[int, int], str] = {}
for _ratio in ALLOWED_RATIOS:
    _w_s, _h_s = _ratio.split(":")
    _w, _h = int(_w_s), int(_h_s)
    _g = _gcd(_w, _h)
    _RATIO_ASPECTS[(_w // _g, _h // _g)] = _ratio
    _DIMENSION_ASPECTS[(_w // _g, _h // _g)] = _ratio

# 竖屏像素输入（宽<高）应优先匹配竖屏比例：720x1280 -> 9:16。
_DIMENSION_ASPECTS[(9, 16)] = "9:16"

DEFAULT_RATIO_TO_SIZE_MAPPING: dict[str, str] = {
    "16:9": "1280x720",
    "4:3": "1024x768",
    "1:1": "1024x1024",
    "3:4": "768x1024",
    "9:16": "720x1280",
    "21:9": "1680x720",
}


def infer_ratio_from_size(value: str | None) -> str | None:
    """从宽高比或像素尺寸推断标准比例；无法识别时返回 None。"""
    if not value:
        return None
    text = value.strip().lower()
    if ":" in text:
        left, _, right = text.partition(":")
        try:
            w, h = int(left), int(right)
            if w <= 0 or h <= 0:
                return None
            divisor = _gcd(w, h)
            return _RATIO_ASPECTS.get((w // divisor, h // divisor))
        except ValueError:
            return None
    if "x" in text:
        left, _, right = text.partition("x")
        try:
            w, h = int(left), int(right)
            if w <= 0 or h <= 0:
                return None
            divisor = _gcd(w, h)
            reduced_w, reduced_h = w // divisor, h // divisor
            if reduced_w >= reduced_h:
                return _DIMENSION_ASPECTS.get((reduced_w, reduced_h))
            return _DIMENSION_ASPECTS.get((reduced_w, reduced_h))
        except ValueError:
            return None
    return None


@dataclass(frozen=True, slots=True)
class VideoModelCapability:
    """供应商/模型能力约束。"""

    supports_seed: bool = True
    supports_watermark: bool = True
    allowed_ratios: set[str] | None = None
    default_ratio: str | None = None
    ratio_to_size_mapping: dict[str, str] | None = None
    min_seconds: int | None = 1
    max_seconds: int | None = None


def register_video_model_capability(
    *,
    provider: ProviderKey,
    model_prefix: str,
    capability: VideoModelCapability,
) -> None:
    """兼容入口：注册模型能力覆盖（按前缀匹配，大小写不敏感）。"""
    if provider == "openai":
        from app.core.integrations.openai.video_capabilities import register_openai_video_capability

        register_openai_video_capability(model_prefix=model_prefix, capability=capability)
        return
    from app.core.integrations.volcengine.video_capabilities import register_volcengine_video_capability

    register_volcengine_video_capability(model_prefix=model_prefix, capability=capability)


def clear_video_model_capability_overrides(*, provider: ProviderKey | None = None) -> None:
    """兼容入口：清空能力覆盖；供测试或重置场景使用。"""
    from app.core.integrations.openai.video_capabilities import clear_openai_video_capability_overrides
    from app.core.integrations.volcengine.video_capabilities import clear_volcengine_video_capability_overrides

    if provider is None:
        clear_openai_video_capability_overrides()
        clear_volcengine_video_capability_overrides()
        return
    if provider == "openai":
        clear_openai_video_capability_overrides()
        return
    clear_volcengine_video_capability_overrides()


def resolve_video_capability(*, provider: ProviderKey, model: str | None) -> VideoModelCapability:
    if provider == "openai":
        from app.core.integrations.openai.video_capabilities import resolve_openai_video_capability

        return resolve_openai_video_capability(model)
    from app.core.integrations.volcengine.video_capabilities import resolve_volcengine_video_capability

    return resolve_volcengine_video_capability(model)


def resolve_effective_ratio(input_: VideoGenerationInput) -> str | None:
    return input_.ratio


def resolve_default_ratio(*, provider: ProviderKey, model: str | None) -> str | None:
    cap = resolve_video_capability(provider=provider, model=model)
    if cap.default_ratio:
        return cap.default_ratio
    if cap.allowed_ratios:
        return sorted(cap.allowed_ratios)[0]
    return "16:9"


def derive_provider_size(
    *,
    provider: ProviderKey,
    model: str | None,
    ratio: VideoRatio,
) -> str | None:
    cap = resolve_video_capability(provider=provider, model=model)
    mapping = cap.ratio_to_size_mapping or DEFAULT_RATIO_TO_SIZE_MAPPING
    return mapping.get(ratio)


def validate_video_options(
    *,
    provider: ProviderKey,
    model: str | None,
    input_: VideoGenerationInput,
) -> None:
    cap = resolve_video_capability(provider=provider, model=model)
    if input_.ratio and cap.allowed_ratios is not None and input_.ratio not in cap.allowed_ratios:
        raise ValueError(
            f"Unsupported ratio for provider={provider} model={model or '<default>'}: {input_.ratio}. "
            f"Allowed: {sorted(cap.allowed_ratios)}"
        )
    if input_.seconds is not None:
        if cap.min_seconds is not None and input_.seconds < cap.min_seconds:
            raise ValueError(f"seconds must be >= {cap.min_seconds}")
        if cap.max_seconds is not None and input_.seconds > cap.max_seconds:
            raise ValueError(f"seconds must be <= {cap.max_seconds}")
    if input_.seed is not None and not cap.supports_seed:
        raise ValueError(f"seed is not supported by provider={provider} model={model or '<default>'}")
    if input_.watermark is not None and not cap.supports_watermark:
        raise ValueError(f"watermark is not supported by provider={provider} model={model or '<default>'}")
