"""视频生成能力约束与参数映射辅助。"""

from __future__ import annotations

from dataclasses import dataclass
from math import gcd

from app.core.contracts.provider import ProviderKey
from app.core.contracts.video_generation import VideoGenerationInput, VideoRatio

ALLOWED_RATIOS = {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}
DEFAULT_RATIO_TO_SIZE_MAPPING: dict[str, str] = {
    "16:9": "1280x720",
    "4:3": "1024x768",
    "1:1": "1024x1024",
    "3:4": "768x1024",
    "9:16": "720x1280",
    "21:9": "1680x720",
}


def _parse_dimensions(candidate: str) -> tuple[int, int] | None:
    """把 ``WIDTHxHEIGHT`` 解析为正整数尺寸对；格式非法或含非正数时返回 ``None``。

    参数：
        candidate: 已去除首尾空白的候选字符串；分隔符 ``x`` 大小写不敏感，
            允许尺寸与分隔符之间存在空格（如 ``"1920 x 1080"``）。
    返回：
        ``(width, height)``，或 ``None``。
    """
    normalized = candidate.lower().replace(" ", "")
    width_text, separator, height_text = normalized.partition("x")
    if not separator:
        return None
    # ``isdigit`` 同时排除负号、小数点与非数字内容。
    if not (width_text.isdigit() and height_text.isdigit()):
        return None
    width = int(width_text)
    height = int(height_text)
    if width <= 0 or height <= 0:
        return None
    return width, height


def infer_ratio_from_size(value: str | None) -> str | None:
    """从「比例字符串」或「分辨率字符串」推断受支持的宽高比。

    做什么：
    - 直接接受已受支持的比例字符串，如 ``"16:9"``；
    - 接受 ``WIDTHxHEIGHT`` 形式的分辨率，如 ``"1920x1080"``，用最大公约数约简后得到比例；
    - 仅当结果落在 :data:`ALLOWED_RATIOS` 内才返回，否则返回 ``None``。

    为什么存在：
    - 供应商参数既可能给比例也可能给具体尺寸，上层需要一个统一的归一化入口，
      避免在各处重复解析尺寸字符串。

    参数：
        value: 比例（``"9:16"``）或分辨率（``"720x1280"``）字符串；允许首尾空白，
            分隔符 ``x`` 大小写不敏感。

    返回：
        归一化后的比例字符串；输入为空白、格式非法、含零或负数尺寸、
        或约简结果不受支持时返回 ``None``。
    """
    if not isinstance(value, str):
        return None

    candidate = value.strip()
    if not candidate:
        return None

    # 已经是受支持的比例字符串：原样返回。
    if candidate in ALLOWED_RATIOS:
        return candidate

    dimensions = _parse_dimensions(candidate)
    if dimensions is None:
        return None

    width, height = dimensions
    divisor = gcd(width, height)
    ratio = f"{width // divisor}:{height // divisor}"
    return ratio if ratio in ALLOWED_RATIOS else None


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
