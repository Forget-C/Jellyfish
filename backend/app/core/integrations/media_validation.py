"""媒体预检和提交使用相同的供应商参数校验。"""

from app.core.contracts.generation import FrozenGenerationConfig, ImageGenerationOperationInput, TypedOperationInput, VideoGenerationOperationInput
from app.core.contracts.image_generation import ImageGenerationInput, ImagePurpose, InputImageRef
from app.core.contracts.media import ImageMediaInput, VideoMediaInput
from app.core.contracts.model_capabilities import ModelCapabilityProfile
from app.core.contracts.video_generation import VideoFrameReferences, VideoGenerationInput, VideoSubjectReference
from app.core.integrations.image_capabilities import prepare_image_options
from app.core.integrations.kling.video_capabilities import validate_kling_video_options
from app.core.integrations.video_capabilities import validate_video_declaration, validate_video_options


def validate_media_parameters(
    config: FrozenGenerationConfig,
    operation: TypedOperationInput,
    media: ImageMediaInput | VideoMediaInput | None,
    prompt: str | None,
    *,
    image_purpose: ImagePurpose = "video_reference",
) -> None:
    """在加载媒体字节前，使用任务配置及实际参考组合校验生成参数。"""
    profile = ModelCapabilityProfile.model_validate(config.capability_profile or {})
    provider, name = config.provider_key, config.model_name
    if isinstance(operation, ImageGenerationOperationInput):
        references = media.references if isinstance(media, ImageMediaInput) else []
        prepare_image_options(provider, ImageGenerationInput(
            prompt=prompt, model=name, n=operation.count,
            target_ratio=operation.target_ratio, resolution_profile=operation.resolution_profile,
            size=operation.size, seed=operation.seed, watermark=operation.watermark,
            purpose=image_purpose, images=[InputImageRef(file_id=ref.file_id) for ref in references],
        ), profile.image_modes)
    if isinstance(operation, VideoGenerationOperationInput):
        video_media = media if isinstance(media, VideoMediaInput) else VideoMediaInput()
        video = VideoGenerationInput(
            prompt=prompt, model=name, ratio=operation.ratio, seconds=operation.seconds, seed=operation.seed,
            resolution=operation.resolution, audio=operation.audio,
            frame_references=VideoFrameReferences(first_frame=video_media.frames.first,
                                                  last_frame=video_media.frames.last, key_frames=video_media.frames.keys),
            subject_references=[VideoSubjectReference(name=subject.name, media=subject.media)
                                for subject in video_media.subjects],
        )
        if provider == "kling":
            validate_kling_video_options(video)
        else:
            validate_video_options(provider=provider, model=name, input_=video)
        validate_video_declaration(provider, video, profile.video_modes)
