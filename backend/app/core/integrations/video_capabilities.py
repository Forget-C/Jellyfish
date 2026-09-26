"""视频生成能力约束与参数映射辅助。"""

from __future__ import annotations

import math
from dataclasses import dataclass

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
    # 分辨率档位（如 {"480p","720p","1080p"}）。None 表示不校验、由供应商取默认。
    allowed_resolutions: set[str] | None = None
    default_resolution: str | None = None
    # 供应商是否自带"生成音频"开关（APIMart 协议里有 generate_audio）。
    supports_generate_audio: bool = False
    # 供应商是否接受**参考音频**（``audio_urls``）作为输入。
    # APIMart / seedance 官方文档明确支持，见 apimart/video_capabilities.py。
    supports_audio_input: bool = False
    # 参考音频条数上限（seedance：3）与总时长上限（秒）。
    max_audio_inputs: int = 0
    max_audio_seconds: int | None = None
    # 参考音频是否要求同时提供参考图/参考视频（seedance：是）。
    audio_input_requires_reference: bool = False
    # 首尾帧图片与参考音频是否互斥（seedance 官方警告：使用首尾帧时参考音频不可用）。
    audio_input_conflicts_with_frame_roles: bool = False


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
    if provider == "apimart":
        from app.core.integrations.apimart.video_capabilities import register_apimart_video_capability

        register_apimart_video_capability(model_prefix=model_prefix, capability=capability)
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
        from app.core.integrations.apimart.video_capabilities import clear_apimart_video_capability_overrides

        clear_apimart_video_capability_overrides()
        return
    if provider == "openai":
        clear_openai_video_capability_overrides()
        return
    if provider == "apimart":
        from app.core.integrations.apimart.video_capabilities import clear_apimart_video_capability_overrides

        clear_apimart_video_capability_overrides()
        return
    clear_volcengine_video_capability_overrides()


def resolve_video_capability(*, provider: ProviderKey, model: str | None) -> VideoModelCapability:
    if provider == "openai":
        from app.core.integrations.openai.video_capabilities import resolve_openai_video_capability

        return resolve_openai_video_capability(model)
    if provider == "apimart":
        from app.core.integrations.apimart.video_capabilities import resolve_apimart_video_capability

        return resolve_apimart_video_capability(model)
    from app.core.integrations.volcengine.video_capabilities import resolve_volcengine_video_capability

    return resolve_volcengine_video_capability(model)


def resolve_effective_resolution(*, provider: ProviderKey, model: str | None, requested: str | None) -> str | None:
    """解析最终分辨率档位：显式请求 > 能力默认 > 不传（由供应商取默认）。

    仅对声明了分辨率档位的供应商生效；未声明时原样透传请求值。
    """
    cap = resolve_video_capability(provider=provider, model=model)
    want = (requested or "").strip()
    if want:
        if cap.allowed_resolutions is not None and want not in cap.allowed_resolutions:
            raise ValueError(
                f"Unsupported resolution for provider={provider} model={model or '<default>'}: {want}. "
                f"Allowed: {sorted(cap.allowed_resolutions)}"
            )
        return want
    if cap.allowed_resolutions is not None:
        return cap.default_resolution or sorted(cap.allowed_resolutions)[0]
    return None


def resolve_effective_ratio(input_: VideoGenerationInput) -> str | None:
    return input_.ratio


# 优先级 if 链：多个 return 是这段规则最清楚的表达（不该为了行数拆成状态机）
# pylint: disable=too-many-return-statements
def infer_ratio_from_size(value: str | None) -> str | None:
    """从「比例」或「像素尺寸」字符串反推画幅比例。

    - ``"16:9"`` → ``"16:9"``（本就是比例，且在白名单内时原样返回）
    - ``"1920x1080"`` → ``"16:9"``；``"720x1280"`` → ``"9:16"``
    - 认不出来（``"abc"``、缺维度、约简后不在白名单）→ ``None``

    用于把各供应商五花八门的 size 字段收敛回业务层唯一的 ``ratio`` 主参数。
    """
    raw = str(value or "").strip().lower()
    if not raw:
        return None

    # 已经是比例形式
    if ":" in raw and "x" not in raw:
        left, _, right = raw.partition(":")
        if left.strip().isdigit() and right.strip().isdigit():
            candidate = f"{int(left)}:{int(right)}"
            return candidate if candidate in ALLOWED_RATIOS else None
        return None

    if "x" not in raw:
        return None

    left, _, right = raw.partition("x")
    left, right = left.strip(), right.strip()
    if not (left.isdigit() and right.isdigit()):
        return None
    width, height = int(left), int(right)
    if width <= 0 or height <= 0:
        return None

    divisor = math.gcd(width, height)
    candidate = f"{width // divisor}:{height // divisor}"
    return candidate if candidate in ALLOWED_RATIOS else None


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


def audio_input_supported(*, provider: ProviderKey, model: str | None) -> bool:
    """该 provider/模型是否接受"上传音频"作为输入。

    调用方据此决定要不要把绑定音频写进请求，以及要不要给用户"这次没用上"的提示。
    """
    return bool(resolve_video_capability(provider=provider, model=model).supports_audio_input)


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
    if getattr(input_, "generate_audio", None) is not None and not cap.supports_generate_audio:
        raise ValueError(
            f"generate_audio is not supported by provider={provider} model={model or '<default>'}"
        )
    # 注意：上传音频（audio_url / audio_base64）**不在这里报错**。它属于"尽力而为"的输入：
    # 供应商不支持时由适配器忽略并在上层返回明确提示，而不是让整次生成失败。
    requested_resolution = getattr(input_, "resolution", None)
    if requested_resolution and cap.allowed_resolutions is not None:
        want = str(requested_resolution).strip()
        if want and want not in cap.allowed_resolutions:
            raise ValueError(
                f"Unsupported resolution for provider={provider} model={model or '<default>'}: {want}. "
                f"Allowed: {sorted(cap.allowed_resolutions)}"
            )
