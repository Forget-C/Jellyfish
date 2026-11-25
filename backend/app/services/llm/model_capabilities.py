"""Resolve model declarations against the capabilities of each integrated operation."""

from app.core.contracts.model_capabilities import EffectiveModelCapabilities, ModelCapabilityProfile, ModelOperation, ModelOperationCapabilities
from app.models.llm import Model, ModelCategoryKey, Provider, ProviderStatus
from app.core.integrations.model_capabilities import describe_operation


def model_operation_capabilities(model: Model, provider: Provider, operation: ModelOperation,
                                 profile: ModelCapabilityProfile | None = None) -> ModelOperationCapabilities:
    """查询登记模型在指定操作下的有效能力。调用方可复用已加载的模型记录。"""
    category = {"image_generation": "image", "video_generation": "video"}.get(operation, "text")
    if model.category != category or provider.status == ProviderStatus.disabled:
        return ModelOperationCapabilities()
    return describe_operation(provider.provider_key, model.name,
                              profile or ModelCapabilityProfile.model_validate(model.capability_profile or {}), operation)


def effective_chat_capabilities(model: Model, provider: Provider, profile: ModelCapabilityProfile) -> EffectiveModelCapabilities:
    """供画布助手判断已登记模型的聊天能力。"""
    return model_operation_capabilities(model, provider, "chat", profile).features
