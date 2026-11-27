"""按具体操作解析当前适配器与模型声明共同允许的能力。"""

from typing import Literal, get_args

from app.core.contracts.model_capabilities import ModelCapabilityProfile, ModelOperation, ModelOperationCapabilities, VideoModeDeclaration, VideoOperationMode
from app.core.integrations.image_capabilities import describe_image_modes
from app.core.integrations.media_provider import supports_remote_cancel
from app.core.integrations.text_capabilities import describe_model
from app.core.integrations.video_capabilities import describe_video_modes


def describe_operation(provider: str, model: str, profile: ModelCapabilityProfile,
                       operation: ModelOperation) -> ModelOperationCapabilities:
    """使用已解析或已冻结的配置，供产品查询和执行入口共享。"""
    category = {"image_generation": "image", "video_generation": "video"}.get(operation, "text")
    profile = model_profile(provider, model, category, profile)
    result = ModelOperationCapabilities()
    if operation in ("chat", "storyboard_inspection"):
        result.features = describe_model(provider, model, profile, operation=operation)
        return result
    if operation == "video_generation":
        result.video_modes = describe_video_modes(provider, model, profile.video_modes)
        remote = True
    else:
        result.image_modes = describe_image_modes(provider, model, profile.image_modes)
        if not result.image_modes:
            return result
        remote = provider in {"vidu", "kling"}
    result.features.remote_task = remote and profile.remote_task
    result.features.direct_result = not remote and profile.direct_result
    result.features.remote_cancel = (result.features.remote_task and supports_remote_cancel(provider, operation)
                                     and profile.remote_cancel)
    return result


def require_media_operation(provider: str, model: str, profile: ModelCapabilityProfile,
                            operation: Literal["image_generation", "video_generation"]) -> ModelOperationCapabilities:
    """只向供应商发送已登记模型允许其执行方式的媒体请求。"""
    effective = describe_operation(provider, model, profile, operation)
    if not (effective.features.remote_task or effective.features.direct_result):
        raise ValueError(f"Unsupported media delivery for {operation}")
    return effective


def model_profile(provider: str, model: str, category: str,
                  overrides: ModelCapabilityProfile | None = None) -> ModelCapabilityProfile:
    """Resolve sparse saved or catalog settings against the current model defaults."""
    values = overrides.model_dump(exclude_unset=True) if overrides else {}
    if category == "text":
        from app.core.integrations.text_capabilities import check_media_support, supports_synchronized_video_audio
        image, video = check_media_support(provider, model)
        return ModelCapabilityProfile.model_validate({
            "image_inputs": image, "video_inputs": video,
            "audio_inputs": supports_synchronized_video_audio(provider, model), **values,
        })
    defaults = {key: False for key, field in ModelCapabilityProfile.model_fields.items()
                if field.annotation is bool}
    image = category == "image"
    operation = "image_generation" if image else "video_generation"
    remote = not image or provider in {"vidu", "kling"}
    defaults.update(text_inputs=True, image_outputs=image, video_outputs=not image,
                    direct_result=not remote, remote_task=remote,
                    remote_cancel=supports_remote_cancel(provider, operation))
    if image:
        modes = describe_image_modes(provider, model, {})
        if provider == "vidu" and model == "viduq1":
            modes["text_to_image"].supported = False
        defaults["image_modes"] = modes
    else:
        defaults["video_modes"] = describe_video_modes(provider, model, {
            mode: VideoModeDeclaration() for mode in get_args(VideoOperationMode)
        })
    mode_key = "image_modes" if image else "video_modes"
    modes = defaults[mode_key]
    if not model:
        for name, mode in modes.items():
            mode.supported = name in {"text_to_image", "text_to_video"}
    for name, options in values.pop(mode_key, {}).items():
        if name in modes:
            modes[name] = type(modes[name]).model_validate({**modes[name].model_dump(), **options})
    defaults["image_inputs"] = any(mode.supported for key, mode in modes.items()
                                   if key not in {"text_to_image", "text_to_video"})
    return ModelCapabilityProfile.model_validate({**defaults, **values})
