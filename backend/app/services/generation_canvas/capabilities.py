"""从已接入 DTO 和适配器能力派生画布选项，不依赖界面示例模型名。"""
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.integrations.image_capabilities import resolve_image_capability, DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP
from app.core.integrations.video_capabilities import resolve_video_capability
from app.services.llm.provider_registry import resolve_provider_key_from_name
from app.models.llm import Model, Provider
from app.schemas.generation_canvas import CanvasModelCapability, ModelCard
from app.services.common import get_or_404


async def model_capability(db: AsyncSession, model_id: str) -> CanvasModelCapability:
    """选定模型的真实选项；文本 DTO 只接收文本，没有逐卡参数覆盖。"""
    model = await get_or_404(db, Model, model_id, detail='Model not found')
    provider = await get_or_404(db, Provider, model.provider_id, detail='Provider not found')
    key = resolve_provider_key_from_name(provider.name)
    result = CanvasModelCapability(model_id=model.id, modality=model.category, input_ports=['text'])
    if model.category == 'image':
        cap = resolve_image_capability(provider=key, model=model.name)
        profiles = cap.ratio_size_profiles or DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP
        result.input_ports.append('image')
        result.ratios = sorted(cap.supported_ratios or profiles.keys())
        result.resolution_profiles = profiles
        result.min_count, result.max_count = cap.min_n or 1, cap.max_n or 10
    if model.category == 'video':
        cap = resolve_video_capability(provider=key, model=model.name)
        result.input_ports.extend(['first_frame', 'last_frame', 'key_frame'])
        if cap.supports_subject_image_reference:
            result.input_ports.append('subject_image')
        if cap.supports_subject_video_reference:
            result.input_ports.append('subject_video')
        result.ratios = sorted(cap.allowed_ratios or {'16:9'})
        result.min_seconds, result.max_seconds = cap.min_seconds, cap.max_seconds
        result.supports_seed = cap.supports_seed
        result.supports_subject_reference_with_frame_reference = cap.supports_subject_reference_with_frame_reference
        for name in ('max_subjects', 'max_images_per_subject', 'max_videos_per_subject', 'max_media_per_subject', 'max_total_subject_videos'):
            setattr(result, name, getattr(cap, name))
    return result


def parameter_diagnostics(card: ModelCard, capability: CanvasModelCapability) -> list[dict]:
    """保存允许不完整配置；编译/预检和界面共享有效参数诊断。"""
    issues = []
    def issue(field, message):
        issues.append({'code': 'INVALID_PARAMETER', 'severity': 'error', 'message': message,
                       'target': {'card_id': card.id, 'path': ['config', field]}, 'blocks': ['run']})
    if card.type != 'model.' + capability.modality:
        issue('model_id', '模型类别与卡片不匹配')
    config = card.config.model_dump()
    ratio = config.get('ratio', config.get('target_ratio'))
    if ratio and ratio not in capability.ratios:
        issue('ratio' if card.type == 'model.video' else 'target_ratio', '当前模型不支持该画幅')
    if card.type == 'model.video' and not ratio:
        issue('ratio', '请选择视频画幅')
    seconds = config.get('seconds')
    if seconds is not None and ((capability.min_seconds is not None and seconds < capability.min_seconds)
                                or (capability.max_seconds is not None and seconds > capability.max_seconds)):
        issue('seconds', '时长超出模型允许范围')
    if config.get('seed') is not None and not capability.supports_seed:
        issue('seed', '当前模型不支持随机种子')
    count = config.get('count')
    if count is not None and not capability.min_count <= count <= capability.max_count:
        issue('count', '图片数量超出模型允许范围')
    profile = config.get('resolution_profile')
    if profile and ratio and profile not in capability.resolution_profiles.get(ratio, {}):
        issue('resolution_profile', '当前模型不支持该分辨率档位')
    return issues
