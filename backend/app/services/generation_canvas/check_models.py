"""检查模型的媒体能力与请求协议；只消费受理时冻结的配置。"""
from typing import Any

from app.core.contracts.generation import FrozenGenerationConfig
from app.core.contracts.model_capabilities import ModelCapabilityProfile
from app.core.integrations.model_capabilities import describe_operation


from app.core.integrations.text_capabilities import BAILIAN_OMNI_MODEL


def _check_capabilities(model: FrozenGenerationConfig):
    profile = ModelCapabilityProfile.model_validate(model.capability_profile or {})
    return describe_operation(model.provider_key, model.model_name, profile, "storyboard_inspection").features


def supports_check_image(model: FrozenGenerationConfig | None) -> bool:
    """Only the explicit Bailian Chat Completions image routes are connected."""
    return bool(model and _check_capabilities(model).image_inputs)


def supports_check_video(model: FrozenGenerationConfig | None) -> bool:
    """Only the connected Bailian video-file routes may inspect continuous video."""
    return bool(model and _check_capabilities(model).video_inputs)


def check_model_parameters(model: FrozenGenerationConfig) -> dict[str, Any]:
    """准备检查专用参数，不修改冻结配置；连接资源与超时仍由 Worker 注入。"""
    params = dict(model.model_params)
    if params.get('use_responses_api'):
        return params
    extra_body = dict(params.get('extra_body', {}))
    if model.provider_key == 'aliyun_bailian' and model.model_name == BAILIAN_OMNI_MODEL:
        # 汇总 Omni 的流式 JSON 文字，再由检查逻辑核对字段及证据。
        params['streaming'] = True
        extra_body.pop('enable_thinking', None)
        extra_body.update(modalities=['text'], reasoning_effort='none', response_format={'type': 'json_object'})
    else:
        extra_body['enable_thinking'] = False
    params['extra_body'] = extra_body
    return params
