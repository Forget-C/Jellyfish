"""检查模型的媒体能力与请求协议；只消费受理时冻结的配置。"""
from typing import Any

from app.core.contracts.generation import FrozenGenerationConfig


_OMNI_CHECK_MODEL = 'qwen3.8-omni-flash'
_VIDEO_MODELS = frozenset({'qwen3-vl-plus', _OMNI_CHECK_MODEL})
_IMAGE_MODELS = _VIDEO_MODELS | {'qwen3-vl-flash'}


def supports_check_image(model: FrozenGenerationConfig | None) -> bool:
    """Only the explicit Bailian Chat Completions image routes are connected."""
    return bool(model and model.provider_key == 'aliyun_bailian' and model.model_name in _IMAGE_MODELS)


def supports_check_video(model: FrozenGenerationConfig | None) -> bool:
    """Only the connected Bailian video-file routes may inspect continuous video."""
    return bool(model and model.provider_key == 'aliyun_bailian' and model.model_name in _VIDEO_MODELS)


def check_model_parameters(model: FrozenGenerationConfig, *, multimodal: bool = False) -> dict[str, Any]:
    """准备检查专用参数，不修改冻结配置；连接资源与超时仍由 Worker 注入。"""
    params = dict(model.model_params)
    extra_body = dict(params.get('extra_body', {}))
    if model.provider_key == 'aliyun_bailian' and model.model_name == _OMNI_CHECK_MODEL:
        # 汇总 Omni 的流式 JSON 文字，再由检查逻辑核对字段及证据。
        params.update(streaming=True, use_responses_api=False)
        extra_body.pop('enable_thinking', None)
        extra_body.update(modalities=['text'], reasoning_effort='none', response_format={'type': 'json_object'})
    else:
        extra_body['enable_thinking'] = False
    params['extra_body'] = extra_body
    if multimodal:
        params['use_responses_api'] = False
    return params
