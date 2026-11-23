"""Resolve model declarations against the capabilities of each integrated operation."""

from app.core.contracts.model_capabilities import EffectiveModelCapabilities, ModelCapabilityProfile
from app.models.llm import Model, ModelCategoryKey, Provider, ProviderStatus
from app.services.generation_canvas.check_models import check_media_support, supports_synchronized_video_audio


def effective_chat_capabilities(
    model: Model, provider: Provider, profile: ModelCapabilityProfile,
) -> EffectiveModelCapabilities:
    """The current text chat integration preserves text use for legacy configurations."""
    if model.category != ModelCategoryKey.text or provider.status == ProviderStatus.disabled:
        return EffectiveModelCapabilities()
    text_inputs = profile.text_inputs.declaration != "unsupported"
    text_outputs = profile.text_outputs.declaration != "unsupported"
    video_inputs = (
        text_inputs and text_outputs and profile.video_inputs.declaration == 'supported'
        and check_media_support(provider.provider_key, model.name)[1]
    )
    return EffectiveModelCapabilities(
        text_inputs=text_inputs,
        text_outputs=text_outputs,
        image_inputs=text_inputs and text_outputs and profile.image_inputs.declaration == 'supported',
        video_inputs=video_inputs,
        audio_inputs=(video_inputs and profile.audio_inputs.declaration == 'supported'
                      and supports_synchronized_video_audio(provider.provider_key, model.name)),
        tool_calling=text_inputs and text_outputs and profile.tool_calling.declaration == "supported",
        max_input_tokens=profile.max_input_tokens,
    )


def effective_storyboard_inspection_capabilities(
    model: Model, provider: Provider, profile: ModelCapabilityProfile,
) -> EffectiveModelCapabilities:
    """Report the media explicitly connected to the existing storyboard check route."""
    if model.category != ModelCategoryKey.text or provider.status == ProviderStatus.disabled:
        return EffectiveModelCapabilities()
    image, video = check_media_support(provider.provider_key, model.name)
    return EffectiveModelCapabilities(
        text_inputs=profile.text_inputs.declaration != "unsupported",
        text_outputs=profile.text_outputs.declaration != "unsupported",
        image_inputs=image and profile.image_inputs.declaration != "unsupported",
        video_inputs=video and profile.video_inputs.declaration != "unsupported",
        max_input_tokens=profile.max_input_tokens,
    )
