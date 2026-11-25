"""按具体操作解析当前适配器与模型声明共同允许的能力。"""

from app.core.contracts.model_capabilities import ModelCapabilityProfile, ModelOperation, ModelOperationCapabilities
from app.core.integrations.image_capabilities import describe_image_modes
from app.core.integrations.media_provider import supports_remote_cancel
from app.core.integrations.text_capabilities import describe_model
from app.core.integrations.video_capabilities import describe_video_modes


def describe_operation(provider: str, model: str, profile: ModelCapabilityProfile,
                       operation: ModelOperation) -> ModelOperationCapabilities:
    """使用已解析或已冻结的配置，供产品查询和执行入口共享。"""
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
    result.features.remote_task = remote
    result.features.direct_result = not remote
    result.features.remote_cancel = (result.features.remote_task and supports_remote_cancel(provider, operation)
                                     and profile.remote_cancel.declaration != "unsupported")
    return result
