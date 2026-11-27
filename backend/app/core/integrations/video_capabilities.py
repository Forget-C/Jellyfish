"""视频生成能力约束与参数映射辅助。"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.contracts.model_capabilities import VideoDurationRange, VideoModeDeclaration, VideoOperationMode
from app.core.contracts.provider import ProviderKey
from app.core.contracts.model_provider import ModelProviderConfigurationError
from app.core.contracts.provider_media import ProviderVideoInput
from app.core.contracts.video_generation import AudioCapability, VideoGenerationInput, VideoRatio

ALLOWED_RATIOS = {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}
DEFAULT_RATIO_TO_SIZE_MAPPING: dict[str, str] = {
    "16:9": "1280x720",
    "4:3": "1024x768",
    "1:1": "1024x1024",
    "3:4": "768x1024",
    "9:16": "720x1280",
    "21:9": "1680x720",
}


def describe_video_modes(
    provider: ProviderKey, model: str, declarations: dict[VideoOperationMode, VideoModeDeclaration],
) -> dict[VideoOperationMode, VideoModeDeclaration]:
    """将用户声明与已接入的操作范围求交，提供给管理页和生成表单。"""
    from app.core.integrations.video_adapter_usage import resolve_video_adapter_usage

    capability = resolve_video_capability(provider=provider, model=model)
    usage = resolve_video_adapter_usage(provider=provider, model=model)
    supported_modes = {"text_to_video"}
    if "first_frame" in usage.frame_roles:
        supported_modes.add("first_frame")
    if "first_frame" in usage.frame_roles and "last_frame" in usage.frame_roles:
        supported_modes.add("first_last_frames")
    if "key_frame" in usage.frame_roles:
        supported_modes.add("key_frames")
    if usage.subject_media_kinds and (capability.supports_subject_image_reference or capability.supports_subject_video_reference):
        supported_modes.add("subject_reference")
    audio = provider == "vidu" and model.startswith("viduq3")
    declarations = dict(declarations)
    if capability.seconds_by_resolution:
        for mode in supported_modes:
            declarations.setdefault(mode, VideoModeDeclaration())
    low, high = capability.min_seconds or 1, capability.max_seconds
    options = {}
    for mode, rule in declarations.items():
        duration_options = {}
        if provider == "vidu":
            durations = rule.duration_by_resolution or capability.seconds_by_resolution
            for resolution, duration in durations.items():
                if capability.seconds_by_resolution:
                    values = capability.seconds_by_resolution.get(resolution, ())
                    if isinstance(duration, VideoDurationRange):
                        duration = [v for v in values if duration.min_seconds <= v <= duration.max_seconds]
                    else:
                        duration = sorted(set(values).intersection(duration))
                if isinstance(duration, VideoDurationRange):
                    minimum = max(low, duration.min_seconds)
                    maximum = min(high, duration.max_seconds) if high is not None else duration.max_seconds
                    if minimum <= maximum:
                        duration_options[resolution] = VideoDurationRange(min_seconds=minimum, max_seconds=maximum)
                else:
                    values = sorted({value for value in duration if value >= low and (high is None or value <= high)})
                    if values:
                        duration_options[resolution] = values
        ratios = capability.allowed_ratios
        if rule.ratios is not None:
            ratios = set(rule.ratios) if ratios is None else ratios.intersection(rule.ratios)
        exposed_kinds = set(usage.subject_media_kinds) if mode == "subject_reference" else (
            set() if mode == "text_to_video" else {"image"}
        )
        if rule.reference_kinds is not None:
            exposed_kinds.intersection_update(rule.reference_kinds)
        options[mode] = rule.model_copy(update={
            "supported": (rule.supported is not False and usage.model_supported and mode in supported_modes
                          and (not rule.duration_by_resolution or bool(duration_options))),
            "ratios": sorted(ratios) if ratios is not None else None,
            "duration_by_resolution": duration_options,
            "reference_kinds": sorted(exposed_kinds),
            "combine_subjects_and_frames": capability.supports_subject_reference_with_frame_reference
            and rule.combine_subjects_and_frames is not False,
            "audio_reference_input": capability.audio_reference_input.connected and rule.audio_reference_input is not False,
            "native_audio_output": (capability.native_audio_output.connected or audio) and rule.native_audio_output is not False,
            "audio_switch": (capability.audio_switch.connected or audio) and rule.audio_switch is not False,
        })
    return options


def validate_video_declaration(
    provider: ProviderKey,
    input_: VideoGenerationInput,
    modes: dict[VideoOperationMode, VideoModeDeclaration],
) -> None:
    """校验配置声明中的模式、参考组合与分辨率时长约束。"""
    if input_.resolution is not None and provider != "vidu":
        raise ValueError("resolution is not supported by this video adapter")
    if input_.audio is not None and (provider != "vidu" or not (input_.model or "").startswith("viduq3")):
        raise ValueError("audio is not supported by this video adapter")
    frames = input_.frame_references
    frame_count = int(bool(frames.first_frame)) + int(bool(frames.last_frame)) + len(frames.key_frames)
    subjects = input_.subject_references
    mode: VideoOperationMode = "text_to_video"
    if subjects:
        mode = "subject_reference"
    elif frames.key_frames:
        mode = "key_frames"
    elif frames.first_frame and frames.last_frame:
        mode = "first_last_frames"
    elif frame_count:
        mode = "first_frame"
    rule = modes.get(mode)
    if rule is None:
        return
    if rule.supported is False:
        raise ValueError(f"video mode is unsupported: {mode}")
    if input_.ratio is not None and rule.ratios is not None and input_.ratio not in rule.ratios:
        raise ValueError("ratio is outside the declared video options")
    if frames and frame_count and subjects and rule.combine_subjects_and_frames is False:
        raise ValueError("subject and frame references cannot be combined in this video mode")
    reference_kinds = ["image"] * frame_count
    for subject in subjects:
        if isinstance(input_, ProviderVideoInput):
            reference_kinds.extend(["image"] * len(subject.images) + ["video"] * len(subject.videos))
        else:
            reference_kinds.extend(reference.media_kind for reference in subject.media)
    if rule.reference_kinds is not None and set(reference_kinds).difference(rule.reference_kinds):
        raise ValueError("reference media type is unsupported in this video mode")
    if rule.max_references is not None and len(reference_kinds) > rule.max_references:
        raise ValueError("reference count exceeds the declared video limit")
    if input_.audio is not None and rule.audio_switch is False:
        raise ValueError("audio is unsupported in this video mode")
    if rule.duration_by_resolution:
        duration = rule.duration_by_resolution.get(input_.resolution or "")
        if duration is None:
            raise ValueError("resolution is outside the declared video options")
        seconds = input_.seconds
        if isinstance(duration, VideoDurationRange):
            allowed = seconds is not None and duration.min_seconds <= seconds <= duration.max_seconds
        else:
            allowed = seconds in duration
        if not allowed:
            raise ValueError("seconds are outside the declared options for this resolution")


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
    native_audio_output: AudioCapability = field(default_factory=AudioCapability)
    audio_switch: AudioCapability = field(default_factory=AudioCapability)
    audio_reference_input: AudioCapability = field(default_factory=AudioCapability)
    seconds_by_resolution: dict[str, tuple[int, ...]] = field(default_factory=dict)


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
    if provider != "volcengine":
        raise ModelProviderConfigurationError(f"Unsupported video provider: {provider!r}")
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
    if provider != "volcengine":
        raise ModelProviderConfigurationError(f"Unsupported video provider: {provider!r}")
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
    """校验业务引用或执行期地址的能力限制，两种输入遵守同一数量规则。"""
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
    counts = [
        (len(subject.images), len(subject.videos)) if isinstance(input_, ProviderVideoInput) else (
            sum(reference.media_kind == "image" for reference in subject.media),
            sum(reference.media_kind == "video" for reference in subject.media),
        )
        for subject in subjects
    ]
    total_subject_videos = sum(videos for _, videos in counts)
    if cap.max_total_subject_videos is not None and total_subject_videos > cap.max_total_subject_videos:
        raise ValueError(f"subject references support at most {cap.max_total_subject_videos} videos in total")
    for images, videos in counts:
        if images and not cap.supports_subject_image_reference:
            raise ValueError(f"subject image references are not supported by provider={provider} model={model or '<default>'}")
        if videos and not cap.supports_subject_video_reference:
            raise ValueError(f"subject video references are not supported by provider={provider} model={model or '<default>'}")
        if cap.max_images_per_subject is not None and images > cap.max_images_per_subject:
            raise ValueError(f"a subject supports at most {cap.max_images_per_subject} reference images")
        if cap.max_videos_per_subject is not None and videos > cap.max_videos_per_subject:
            raise ValueError(f"a subject supports at most {cap.max_videos_per_subject} reference videos")
        if cap.max_media_per_subject is not None and images + videos > cap.max_media_per_subject:
            raise ValueError(f"a subject supports at most {cap.max_media_per_subject} reference media items")
