"""从已接入 DTO 和适配器能力派生画布选项，不依赖界面示例模型名。"""
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.contracts.video_generation import AudioCapability
from app.services.llm.model_capabilities import model_operation_capabilities
from app.core.integrations.image_capabilities import resolve_image_capability, resolve_image_mode, DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP
from app.core.integrations.video_capabilities import resolve_video_capability
from app.core.integrations.video_adapter_usage import resolve_video_adapter_usage
from app.models.llm import Model, Provider
from app.schemas.generation_canvas import CanvasModelCapability, ModelCard
from app.services.common import get_or_404


async def model_capability(db: AsyncSession, model_id: str) -> CanvasModelCapability:
    """选定模型的真实选项；文本 DTO 只接收文本，没有逐卡参数覆盖。"""
    model = await get_or_404(db, Model, model_id, detail='Model not found')
    provider = await get_or_404(db, Provider, model.provider_id, detail='Provider not found')
    key = provider.provider_key
    result = CanvasModelCapability(model_id=model.id, modality=model.category, input_ports=['text'])
    if model.category != 'video':
        result.native_audio_output = AudioCapability(declaration='unsupported')
        result.audio_switch = AudioCapability(declaration='unsupported')
        result.audio_reference_input = AudioCapability(declaration='unsupported')
    if model.category == 'image':
        cap = resolve_image_capability(provider=key, model=model.name)
        profiles = cap.ratio_size_profiles or DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP
        result.input_ports.append('image')
        result.ratios = sorted(cap.supported_ratios or profiles.keys())
        result.resolution_profiles = profiles
        modes = model_operation_capabilities(model, provider, "image_generation").image_modes
        result.min_count = cap.min_n or 1
        if modes:
            result.max_count = modes["text_to_image"].max_outputs
            result.reference_max_count = modes[resolve_image_mode(key, 1)].max_outputs
        else:
            result.max_count = cap.max_n or 10
        result.max_reference_images = cap.max_reference_images
        result.supports_duplicate_reference_images = cap.supports_duplicate_reference_images
    if model.category == 'video':
        result.video_modes = model_operation_capabilities(model, provider, "video_generation").video_modes
        cap = resolve_video_capability(provider=key, model=model.name)
        usage = resolve_video_adapter_usage(provider=key, model=model.name)
        result.native_audio_output = cap.native_audio_output
        result.audio_switch = cap.audio_switch
        result.audio_reference_input = cap.audio_reference_input
        # 画布用途按原展示顺序投影；OpenAI 有意只开放首帧。
        roles = [role for role in ('first_frame', 'last_frame', 'key_frame') if role in usage.frame_roles
                 and (key != 'openai' or role == 'first_frame')]
        result.input_ports.extend(roles)
        if 'image' in usage.subject_media_kinds and cap.supports_subject_image_reference:
            result.input_ports.append('subject_image')
        if 'video' in usage.subject_media_kinds and cap.supports_subject_video_reference:
            result.input_ports.append('subject_video')
        result.ratios = sorted(cap.allowed_ratios or {'16:9'})
        result.min_seconds, result.max_seconds = cap.min_seconds, cap.max_seconds
        result.supports_seed = cap.supports_seed
        result.supports_subject_reference_with_frame_reference = False
        for name in ('max_subjects', 'max_images_per_subject', 'max_videos_per_subject', 'max_media_per_subject', 'max_total_subject_videos'):
            setattr(result, name, getattr(cap, name))
    return result


def parameter_diagnostics(card: ModelCard, capability: CanvasModelCapability, *, has_reference: bool = False) -> list[dict]:
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
    if card.type == 'model.video' and config.get('seed') is not None and not -1 <= config['seed'] <= 4294967295:
        issue('seed', '随机种子须为 -1 或 [0, 2^32-1]')
    count = config.get('count')
    maximum = capability.reference_max_count if has_reference and capability.reference_max_count is not None else capability.max_count
    if count is not None and not capability.min_count <= count <= maximum:
        issue('count', '图片数量超出模型允许范围')
    profile = config.get('resolution_profile')
    if profile and ratio and profile not in capability.resolution_profiles.get(ratio, {}):
        issue('resolution_profile', '当前模型不支持该分辨率档位')
    return issues
