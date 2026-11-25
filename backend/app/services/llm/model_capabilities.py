"""Resolve model declarations against the capabilities of each integrated operation."""

from app.core.contracts.model_capabilities import EffectiveModelCapabilities, ModelCapabilityProfile
from app.models.llm import Model, ModelCategoryKey, Provider, ProviderStatus
from app.core.integrations.text_capabilities import describe_model


def effective_chat_capabilities(
    model: Model, provider: Provider, profile: ModelCapabilityProfile,
) -> EffectiveModelCapabilities:
    """The current text chat integration preserves text use for legacy configurations."""
    if model.category != ModelCategoryKey.text or provider.status == ProviderStatus.disabled:
        return EffectiveModelCapabilities()
    return describe_model(provider.provider_key, model.name, profile, operation="chat")


def effective_storyboard_inspection_capabilities(
    model: Model, provider: Provider, profile: ModelCapabilityProfile,
) -> EffectiveModelCapabilities:
    """Report the media explicitly connected to the existing storyboard check route."""
    if model.category != ModelCategoryKey.text or provider.status == ProviderStatus.disabled:
        return EffectiveModelCapabilities()
    return describe_model(provider.provider_key, model.name, profile, operation="storyboard_inspection")
