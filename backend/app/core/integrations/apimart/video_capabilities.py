"""APIMart 视频能力声明与覆盖注册。

数据来源：APIMart 官方文档 seedance-2.0 生成页（2026-09-17 实读）
  - 分辨率：480p / 720p / 1080p / 4k（fast 版仅 480p / 720p）
  - 时长：5—15 秒，默认 5 秒
  - 画幅参数名是 ``size``（不是 ``aspect_ratio``）
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.integrations.video_capabilities import ALLOWED_RATIOS, VideoModelCapability

if TYPE_CHECKING:
    from app.core.contracts.video_generation import VideoGenerationInput

# 通用兜底：APIMart 上不同视频模型的分辨率档位差异较大，
# 未命中覆盖时不做过严约束（allowed_resolutions=None 表示不校验）。
_APIMART_DEFAULT = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    # 协议：generate_audio 开关 + audio_urls 参考音频（数组，公网 URL 或 asset://）
    supports_generate_audio=True,
    supports_audio_input=True,
    max_audio_inputs=3,
    max_audio_seconds=15,
    audio_input_requires_reference=True,
    audio_input_conflicts_with_frame_roles=True,
    allowed_ratios=set(ALLOWED_RATIOS),
    default_ratio="16:9",
    min_seconds=1,
    max_seconds=None,
)

# seedance 2.0 系列：官方明确 480p/720p/1080p/4k，时长 5—15 秒。
_SEEDANCE_20 = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    supports_generate_audio=True,
    supports_audio_input=True,
    max_audio_inputs=3,
    max_audio_seconds=15,
    audio_input_requires_reference=True,
    audio_input_conflicts_with_frame_roles=True,
    allowed_ratios=set(ALLOWED_RATIOS),
    default_ratio="16:9",
    min_seconds=5,
    max_seconds=15,
    allowed_resolutions={"480p", "720p", "1080p", "4k"},
    default_resolution="720p",
)

# seedance 2.0 fast / mini：官方标注 fast 仅 480p/720p。
_SEEDANCE_20_LITE = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    supports_generate_audio=True,
    supports_audio_input=True,
    max_audio_inputs=3,
    max_audio_seconds=15,
    audio_input_requires_reference=True,
    audio_input_conflicts_with_frame_roles=True,
    allowed_ratios=set(ALLOWED_RATIOS),
    default_ratio="16:9",
    min_seconds=5,
    max_seconds=15,
    allowed_resolutions={"480p", "720p"},
    default_resolution="480p",
)

# key: 模型前缀（小写）
_APIMART_MODEL_OVERRIDES: dict[str, VideoModelCapability] = {
    "seedance-2.0-mini": _SEEDANCE_20_LITE,
    "seedance-2.0-fast": _SEEDANCE_20_LITE,
    "seedance-2.0": _SEEDANCE_20,
    "seedance-2-0": _SEEDANCE_20,
}


def register_apimart_video_capability(*, model_prefix: str, capability: VideoModelCapability) -> None:
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _APIMART_MODEL_OVERRIDES[prefix] = capability


def clear_apimart_video_capability_overrides() -> None:
    _APIMART_MODEL_OVERRIDES.clear()


def _pick_override(model: str | None) -> VideoModelCapability | None:
    if not model:
        return None
    value = model.strip().lower()
    if not value:
        return None
    # 最长前缀优先，避免 "seedance-2.0" 覆盖 "seedance-2.0-mini"。
    for prefix, cap in sorted(_APIMART_MODEL_OVERRIDES.items(), key=lambda item: len(item[0]), reverse=True):
        if value.startswith(prefix):
            return cap
    return None


def resolve_apimart_video_capability(model: str | None) -> VideoModelCapability:
    return _pick_override(model) or _APIMART_DEFAULT


def validate_apimart_video_options(input_: VideoGenerationInput) -> None:
    """APIMart 能力校验入口（避免调用侧传 provider 字面量）。"""
    from app.core.contracts.video_generation import VideoGenerationInput
    from app.core.integrations.video_capabilities import validate_video_options

    assert isinstance(input_, VideoGenerationInput)
    validate_video_options(provider="apimart", model=input_.model, input_=input_)
