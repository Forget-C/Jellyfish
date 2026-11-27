"""当前文本适配器能够传递的媒体与对话能力。"""

from typing import Literal

from app.core.contracts.model_capabilities import EffectiveModelCapabilities, ModelCapabilityProfile

BAILIAN_OMNI_MODEL = 'qwen3.8-omni-flash'
_VIDEO_MODELS = frozenset({'qwen3-vl-plus', BAILIAN_OMNI_MODEL})
_IMAGE_MODELS = _VIDEO_MODELS | {'qwen3-vl-flash'}


def check_media_support(provider_key: str, model_name: str) -> tuple[bool, bool]:
    """Return still-image and continuous-video availability for the check adapter."""
    if provider_key != 'aliyun_bailian':
        return False, False
    return model_name in _IMAGE_MODELS, model_name in _VIDEO_MODELS


def supports_synchronized_video_audio(provider_key: str, model_name: str) -> bool:
    """Whether the connected chat endpoint can observe the audio track inside a video."""
    return provider_key == 'aliyun_bailian' and model_name == BAILIAN_OMNI_MODEL


def describe_model(
    provider: str,
    model: str,
    profile: ModelCapabilityProfile,
    *,
    operation: Literal["chat", "storyboard_inspection"],
) -> EffectiveModelCapabilities:
    """根据模型声明与指定操作的接入限制计算有效能力。"""
    if provider not in {"openai", "aliyun_bailian"}:
        return EffectiveModelCapabilities()

    text_inputs = profile.text_inputs
    text_outputs = profile.text_outputs
    if operation == "storyboard_inspection":
        image, video = check_media_support(provider, model)
        return EffectiveModelCapabilities(
            text_inputs=text_inputs,
            text_outputs=text_outputs,
            image_inputs=image and profile.image_inputs,
            video_inputs=video and profile.video_inputs,
            max_input_tokens=profile.max_input_tokens or profile.context_window,
            max_output_tokens=profile.max_output_tokens,
        )

    chat = text_inputs and text_outputs
    video = chat and profile.video_inputs and check_media_support(provider, model)[1]
    tools = chat and profile.tool_calling
    stream = chat and profile.native_streaming
    non_streaming = chat and profile.non_streaming
    return EffectiveModelCapabilities(
        text_inputs=text_inputs,
        text_outputs=text_outputs,
        image_inputs=chat and profile.image_inputs,
        video_inputs=video,
        audio_inputs=video and profile.audio_inputs
        and supports_synchronized_video_audio(provider, model),
        tool_calling=tools,
        tool_results=tools and profile.tool_results,
        parallel_tool_calls=tools and profile.parallel_tool_calls,
        streaming_tool_arguments=tools and stream and profile.streaming_tool_arguments,
        json_object=chat and profile.json_object,
        json_schema=chat and profile.json_schema,
        non_streaming=non_streaming,
        native_streaming=stream,
        direct_result=non_streaming and profile.direct_result,
        max_input_tokens=profile.max_input_tokens or profile.context_window,
        max_output_tokens=profile.max_output_tokens,
    )
