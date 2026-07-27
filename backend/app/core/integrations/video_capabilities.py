"""视频生成能力约束与参数映射辅助。"""

from __future__ import annotations

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


def infer_ratio_from_size(value: str | None) -> str | None:
    """将标准比例或宽高像素串归一化为项目支持的视频比例。"""
    normalized = (value or "").strip()
    if normalized in ALLOWED_RATIOS:
        return normalized
    try:
        width_text, height_text = normalized.lower().split("x", maxsplit=1)
        width, height = int(width_text), int(height_text)
    except ValueError:
        return None
    if width <= 0 or height <= 0:
        return None
    for ratio, size in DEFAULT_RATIO_TO_SIZE_MAPPING.items():
        mapping_width, mapping_height = (int(item) for item in size.split("x", maxsplit=1))
        if width * mapping_height == height * mapping_width:
            return ratio
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
    supports_subject_image_reference: bool = False
    supports_subject_video_reference: bool = False
    supports_subject_reference_with_frame_reference: bool = False
    max_subjects: int | None = None
    max_images_per_subject: int | None = None
    max_videos_per_subject: int | None = None
    max_media_per_subject: int | None = None
    max_total_subject_videos: int | None = None


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
    if provider == "vidu":
        from app.core.integrations.vidu.video_capabilities import register_vidu_video_capability

        register_vidu_video_capability(model_prefix=model_prefix, capability=capability)
        return
    if provider == "kling":
        from app.core.integrations.kling.video_capabilities import register_kling_video_capability

        register_kling_video_capability(model_prefix=model_prefix, capability=capability)
        return
    from app.core.integrations.volcengine.video_capabilities import register_volcengine_video_capability

    register_volcengine_video_capability(model_prefix=model_prefix, capability=capability)


def clear_video_model_capability_overrides(*, provider: ProviderKey | None = None) -> None:
    """兼容入口：清空能力覆盖；供测试或重置场景使用。"""
    from app.core.integrations.openai.video_capabilities import clear_openai_video_capability_overrides
    from app.core.integrations.vidu.video_capabilities import clear_vidu_video_capability_overrides
    from app.core.integrations.volcengine.video_capabilities import clear_volcengine_video_capability_overrides
    from app.core.integrations.kling.video_capabilities import clear_kling_video_capability_overrides

    if provider is None:
        clear_openai_video_capability_overrides()
        clear_volcengine_video_capability_overrides()
        clear_vidu_video_capability_overrides()
        clear_kling_video_capability_overrides()
        return
    if provider == "openai":
        clear_openai_video_capability_overrides()
        return
    if provider == "vidu":
        clear_vidu_video_capability_overrides()
        return
    if provider == "kling":
        clear_kling_video_capability_overrides()
        return
    clear_volcengine_video_capability_overrides()


def resolve_video_capability(*, provider: ProviderKey, model: str | None) -> VideoModelCapability:
    if provider == "openai":
        from app.core.integrations.openai.video_capabilities import resolve_openai_video_capability

        return resolve_openai_video_capability(model)
    if provider == "vidu":
        from app.core.integrations.vidu.video_capabilities import resolve_vidu_video_capability

        return resolve_vidu_video_capability(model)
    if provider == "kling":
        from app.core.integrations.kling.video_capabilities import resolve_kling_video_capability

        return resolve_kling_video_capability(model)
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
    subjects = input_.subject_references
    if not subjects:
        return
    has_frame_reference = any(
        (
            input_.frame_references.first_frame,
            input_.frame_references.last_frame,
            *input_.frame_references.key_frames,
        )
    )
    if has_frame_reference and not cap.supports_subject_reference_with_frame_reference:
        raise ValueError(
            f"subject references cannot be combined with frame references for provider={provider} "
            f"model={model or '<default>'}"
        )
    if cap.max_subjects is not None and len(subjects) > cap.max_subjects:
        raise ValueError(f"subject references must contain at most {cap.max_subjects} subjects")
    total_subject_videos = sum(
        sum(reference.media_kind == "video" for reference in subject.media)
        for subject in subjects
    )
    if cap.max_total_subject_videos is not None and total_subject_videos > cap.max_total_subject_videos:
        raise ValueError(f"subject references support at most {cap.max_total_subject_videos} videos in total")
    for subject in subjects:
        images = [reference for reference in subject.media if reference.media_kind == "image"]
        videos = [reference for reference in subject.media if reference.media_kind == "video"]
        if images and not cap.supports_subject_image_reference:
            raise ValueError(f"subject image references are not supported by provider={provider} model={model or '<default>'}")
        if videos and not cap.supports_subject_video_reference:
            raise ValueError(f"subject video references are not supported by provider={provider} model={model or '<default>'}")
        if cap.max_images_per_subject is not None and len(images) > cap.max_images_per_subject:
            raise ValueError(f"a subject supports at most {cap.max_images_per_subject} reference images")
        if cap.max_videos_per_subject is not None and len(videos) > cap.max_videos_per_subject:
            raise ValueError(f"a subject supports at most {cap.max_videos_per_subject} reference videos")
        if cap.max_media_per_subject is not None and len(subject.media) > cap.max_media_per_subject:
            raise ValueError(f"a subject supports at most {cap.max_media_per_subject} reference media items")
