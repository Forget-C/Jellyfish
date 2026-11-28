"""实际执行和画布共用模型输入规则；只处理元数据，不读取媒体字节或提交任务。"""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.media import MediaReference, VideoFrameMediaReferences, VideoMediaInput, VideoSubjectMediaReference
from app.core.contracts.video_generation import VideoGenerationInput, VideoFrameReferences, VideoSubjectReference, VideoReferenceCapabilities
from app.core.contracts.model_capabilities import VideoModeDeclaration, VideoOperationMode
from app.services.llm.model_capabilities import model_operation_capabilities
from app.core.integrations.video_capabilities import validate_video_declaration, resolve_video_capability
from app.core.integrations.video_adapter_usage import resolve_video_adapter_usage
from app.core.integrations.openai.video_capabilities import validate_openai_video_options
from app.core.integrations.vidu.video_capabilities import validate_vidu_video_options
from app.core.integrations.kling.video_capabilities import validate_kling_video_options
from app.core.integrations.volcengine.video_capabilities import validate_volcengine_video_options
from app.models.llm import Model, ModelCategoryKey, Provider
from app.models.studio import Project
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category


@dataclass(frozen=True)
class VideoUnitModel:
    """一次读取固定模型名、供应商和当前适配器实际可发送的参考范围，不含凭据。"""

    id: str
    name: str
    provider_key: str
    reference_capabilities: VideoReferenceCapabilities
    modes: dict[VideoOperationMode, VideoModeDeclaration]


class UnitVideoInputError(ValueError):
    """同一个输入错误定位到对应配置区域；真实执行仍按 ValueError 拒绝。"""

    def __init__(self, section: Literal['generation', 'references'], message: str):
        super().__init__(message)
        self.section = section


async def read_video_unit_model(db: AsyncSession, project_id: str, model_or_id: Model | str) -> VideoUnitModel:
    """复用模型与供应商解析；未知配置不能被提升为支持。"""
    if not await db.get(Project, project_id):
        raise ValueError("project not found")
    selected = model_or_id if isinstance(model_or_id, Model) else await db.get(Model, model_or_id)
    if selected is None or selected.category != ModelCategoryKey.video:
        raise ValueError("请选择有效的视频模型")
    model = await get_model_by_category(db, ModelCategoryKey.video, model_or_id=selected)
    provider = await db.get(Provider, model.provider_id)
    config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.video)
    cap = resolve_video_capability(provider=config.provider_key, model=model.name)
    usage = resolve_video_adapter_usage(provider=config.provider_key, model=model.name)
    if not usage.model_supported:
        raise ValueError("当前接入不支持此视频模型")
    # 场次工作台在 OpenAI 上只提交一张首帧。
    roles = ["first_frame"] if config.provider_key == "openai" else list(usage.frame_roles)
    max_frames = len(roles) if config.provider_key in {"openai", "kling"} else None
    modes = model_operation_capabilities(model, provider, "video_generation").video_modes
    def frame_limit(mode, required, maximum):
        rule = modes.get(mode)
        if not rule:
            return maximum
        if rule.supported is False or (rule.reference_kinds is not None and "image" not in rule.reference_kinds):
            return 0
        if rule.max_references is None:
            return maximum
        if rule.max_references < required:
            return 0
        return min(maximum, rule.max_references) if maximum is not None else rule.max_references

    # 两帧操作单独声明；关闭单帧模式后，仍可保留能成对使用的首尾帧。
    single = frame_limit("first_frame", 1, 1)
    pair = frame_limit("first_last_frames", 2, 2) if "last_frame" in roles else 0
    keys = frame_limit("key_frames", 1, None) if "key_frame" in roles else 0
    if not single and not pair:
        roles = [role for role in roles if role == "key_frame"]
    if keys == 0:
        roles = [role for role in roles if role != "key_frame"]
    if not roles:
        max_frames = 0
    elif modes and keys is not None:
        max_frames = max(single, pair, keys)
    subject_rule = modes.get("subject_reference")
    kinds = subject_rule.reference_kinds if subject_rule else None
    subjects = bool(usage.subject_media_kinds) and (not subject_rule or subject_rule.supported is not False)
    total = subject_rule.max_references if subject_rule else None
    subjects = subjects and total != 0

    def subject_limit(limit):
        if total is None:
            return limit
        return min(total, limit) if limit is not None else total

    capability = VideoReferenceCapabilities(model_id=model.id, frame_roles=roles, max_frames=max_frames,
        subject_images=subjects and cap.supports_subject_image_reference and (kinds is None or "image" in kinds),
        subject_videos=subjects and cap.supports_subject_video_reference and (kinds is None or "video" in kinds),
        combine_subjects_and_frames=False,
        max_subjects=subject_limit(cap.max_subjects), max_images_per_subject=subject_limit(cap.max_images_per_subject),
        max_videos_per_subject=subject_limit(cap.max_videos_per_subject), max_media_per_subject=subject_limit(cap.max_media_per_subject),
        max_total_subject_videos=subject_limit(cap.max_total_subject_videos),
        limits_status="partial" if max_frames is None else "known")

    return VideoUnitModel(model.id, model.name, config.provider_key, capability, modes)


def validated_video_media(unit, model: VideoUnitModel, text: str = '准备检查') -> VideoMediaInput:
    """校验配置及实际适配器的输入规则；不把图完整或范围数量当作执行授权。"""
    if unit.duration_ms is None:
        raise UnitVideoInputError('generation', '填写预计时长')
    if unit.duration_ms % 1000:
        raise UnitVideoInputError('generation', '当前模型时长按整秒提交，请调整单元预计时长')
    unsupported = set(unit.parameters) - {'seed'}
    if unsupported:
        raise UnitVideoInputError('generation', f"当前执行器不支持参数：{', '.join(sorted(unsupported))}")
    capability = model.reference_capabilities
    try:
        frame_bindings = [binding for binding in unit.references if binding.input_role != "subject"]
        if any(binding.input_role not in capability.frame_roles for binding in frame_bindings):
            raise ValueError("当前模型接入不支持所选帧位置，请更换参考或模型")
        if capability.max_frames is not None and len(frame_bindings) > capability.max_frames:
            raise ValueError(f"当前模型最多发送 {capability.max_frames} 张帧参考，请明确选择")
        if frame_bindings and any(binding.input_role == "subject" for binding in unit.references) and not capability.combine_subjects_and_frames:
            raise ValueError("当前模型接入不支持主体参考与帧参考组合，请明确选择")
        if any(binding.input_role == "subject" and binding.media_kind == "image" for binding in unit.references) and not capability.subject_images:
            raise ValueError("当前模型接入不支持主体图片参考，请更换参考或模型")
        if any(binding.input_role == "subject" and binding.media_kind == "video" for binding in unit.references) and not capability.subject_videos:
            raise ValueError("当前模型接入不支持主体视频参考，请更换参考或模型")
        frames, subjects = {}, {}
        for binding in sorted(unit.references, key=lambda r: r.ordinal):
            if binding.media_kind == "audio":
                raise ValueError("当前执行器不支持声音参考，请保留声音设计并安排后期")
            ref = MediaReference(file_id=binding.file_id, media_kind=binding.media_kind, ordinal=binding.ordinal)
            if binding.input_role == "subject":
                name = binding.subject_group_id or binding.id
                if name in subjects:
                    subjects[name].media.append(ref)
                else:
                    subjects[name] = VideoSubjectMediaReference(name=name, media=[ref])
            elif binding.input_role == "key_frame":
                frames.setdefault("keys", []).append(ref)
            else:
                key = "first" if binding.input_role == "first_frame" else "last"
                if key in frames:
                    raise ValueError("首帧或尾帧只能选择一份图片")
                frames[key] = ref
        frame_media = VideoFrameMediaReferences(**frames)
        media = VideoMediaInput(frames=frame_media, subjects=list(subjects.values()))
    except ValueError as error:
        raise UnitVideoInputError('references', str(error)) from error
    try:
        options = VideoGenerationInput(prompt=text, model=model.name, ratio=unit.ratio,
            seconds=unit.duration_ms // 1000, seed=unit.parameters.get("seed"),
            frame_references=VideoFrameReferences(first_frame=frame_media.first, last_frame=frame_media.last, key_frames=frame_media.keys),
            subject_references=[VideoSubjectReference(name=s.name, media=s.media) for s in subjects.values()])
        validate_video_declaration(model.provider_key, options, model.modes)
        validators = {"openai": validate_openai_video_options, "vidu": validate_vidu_video_options,
                      "kling": validate_kling_video_options, "volcengine": validate_volcengine_video_options}
        validators[model.provider_key](options)
    except ValueError as error:
        raise UnitVideoInputError('generation', str(error)) from error
    return media
