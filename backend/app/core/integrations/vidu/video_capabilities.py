"""Vidu 视频模型能力声明与覆盖注册。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.integrations.video_capabilities import VideoModelCapability

if TYPE_CHECKING:
    from app.core.contracts.video_generation import VideoGenerationInput

_VIDU_COMMON_RATIOS = {"16:9", "9:16", "1:1"}
_VIDU_Q2_Q3_RATIOS = {"16:9", "9:16", "1:1", "3:4", "4:3"}

_VIDU_DEFAULT = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_ratios=_VIDU_COMMON_RATIOS,
    default_ratio="16:9",
    min_seconds=1,
    max_seconds=16,
)
_VIDU_Q2_Q3 = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_ratios=_VIDU_Q2_Q3_RATIOS,
    default_ratio="16:9",
    min_seconds=1,
    max_seconds=16,
    supports_subject_image_reference=True,
    max_subjects=7,
    max_images_per_subject=3,
    max_media_per_subject=3,
)
_VIDU_Q3 = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_ratios=_VIDU_Q2_Q3_RATIOS,
    default_ratio="16:9",
    min_seconds=3,
    max_seconds=16,
    supports_subject_image_reference=True,
    max_subjects=7,
    max_images_per_subject=3,
    max_media_per_subject=3,
)
_VIDU_Q2 = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_ratios=_VIDU_Q2_Q3_RATIOS,
    default_ratio="16:9",
    min_seconds=1,
    max_seconds=10,
    supports_subject_image_reference=True,
    max_subjects=7,
    max_images_per_subject=3,
    max_media_per_subject=3,
)
_VIDU_Q1 = VideoModelCapability(
    supports_seed=True, supports_watermark=False, allowed_ratios=_VIDU_COMMON_RATIOS,
    default_ratio="16:9", min_seconds=5, max_seconds=5, supports_subject_image_reference=True,
    max_subjects=7, max_images_per_subject=3, max_media_per_subject=3,
)
_VIDU_2 = VideoModelCapability(
    supports_seed=True, supports_watermark=False, allowed_ratios=_VIDU_COMMON_RATIOS,
    default_ratio="16:9", min_seconds=4, max_seconds=4, supports_subject_image_reference=True,
    max_subjects=7, max_images_per_subject=3, max_media_per_subject=3,
)
_VIDU_Q2_PRO = VideoModelCapability(
    supports_seed=True,
    supports_watermark=False,
    allowed_ratios=_VIDU_Q2_Q3_RATIOS,
    default_ratio="16:9",
    min_seconds=0,
    max_seconds=10,
    supports_subject_image_reference=True,
    supports_subject_video_reference=True,
    max_subjects=4,
    max_images_per_subject=3,
    max_videos_per_subject=2,
    max_media_per_subject=3,
    max_total_subject_videos=2,
)

_VIDU_MODEL_OVERRIDES: dict[str, VideoModelCapability] = {
    "viduq2-pro": _VIDU_Q2_PRO,
    "viduq2": _VIDU_Q2,
    "viduq1": _VIDU_Q1,
    "vidu2.0": _VIDU_2,
    "viduq3-mix": _VIDU_DEFAULT,
    "viduq3-pro": _VIDU_DEFAULT,
    "viduq3-drama": _VIDU_DEFAULT,
    "viduq3-ad": _VIDU_DEFAULT,
    "viduq3": _VIDU_Q3,
}


def register_vidu_video_capability(*, model_prefix: str, capability: VideoModelCapability) -> None:
    """注册按模型前缀匹配的 Vidu 视频能力覆盖。"""
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _VIDU_MODEL_OVERRIDES[prefix] = capability


def clear_vidu_video_capability_overrides() -> None:
    """清除测试或运行时新增的 Vidu 视频能力覆盖，保留内置模型规则。"""
    _VIDU_MODEL_OVERRIDES.clear()
    _VIDU_MODEL_OVERRIDES.update(
        {
            "viduq3-mix": _VIDU_DEFAULT,
            "viduq3-pro": _VIDU_DEFAULT,
            "viduq3-drama": _VIDU_DEFAULT,
            "viduq3-ad": _VIDU_DEFAULT,
            "viduq2-pro": _VIDU_Q2_PRO,
            "viduq2": _VIDU_Q2,
            "viduq1": _VIDU_Q1,
            "vidu2.0": _VIDU_2,
            "viduq3": _VIDU_Q3,
        }
    )


def resolve_vidu_video_capability(model: str | None) -> VideoModelCapability:
    """按最长模型前缀选择 Vidu 视频能力，未知模型采用通用交集。"""
    value = (model or "").strip().lower()
    for prefix, capability in sorted(_VIDU_MODEL_OVERRIDES.items(), key=lambda item: len(item[0]), reverse=True):
        if value.startswith(prefix):
            return capability
    return _VIDU_DEFAULT


def validate_vidu_video_options(input_: VideoGenerationInput) -> None:
    """在请求 Vidu 前校验项目通用视频参数是否可映射。"""
    from app.core.integrations.video_capabilities import validate_video_options

    validate_video_options(provider="vidu", model=input_.model, input_=input_)
