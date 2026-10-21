"""实际执行和画布共用模型输入规则；只处理元数据，不读取媒体字节或提交任务。"""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.media import MediaReference, VideoFrameMediaReferences, VideoMediaInput, VideoSubjectMediaReference
from app.core.contracts.video_generation import VideoGenerationInput, VideoFrameReferences, VideoSubjectReference, VideoReferenceCapabilities
from app.core.integrations.video_capabilities import validate_video_options, resolve_video_capability
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
    roles = ["first_frame", "last_frame", "key_frame"]
    max_frames = 1 if config.provider_key == "openai" else None
    if config.provider_key == "openai":
        roles = ["first_frame"]
    if config.provider_key == "kling":
        name = model.name.strip().lower()
        if name not in {"kling-3.0", "kling-3.0-turbo"}:
            raise ValueError("当前可灵接入不支持此视频模型")
        roles = ["first_frame", "last_frame"] if name == "kling-3.0" else []
        max_frames = len(roles)
    # 只有 Vidu 的现有请求适配器会传递命名主体，不能仅凭覆盖配置宣称可用。
    subjects = config.provider_key == "vidu"
    capability = VideoReferenceCapabilities(model_id=model.id, frame_roles=roles, max_frames=max_frames,
        subject_images=subjects and cap.supports_subject_image_reference,
        subject_videos=subjects and cap.supports_subject_video_reference,
        combine_subjects_and_frames=False,
        max_subjects=cap.max_subjects, max_images_per_subject=cap.max_images_per_subject,
        max_videos_per_subject=cap.max_videos_per_subject, max_media_per_subject=cap.max_media_per_subject,
        max_total_subject_videos=cap.max_total_subject_videos,
        limits_status="partial" if max_frames is None else "known")

    return VideoUnitModel(model.id, model.name, config.provider_key, capability)


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
        validate_video_options(provider=model.provider_key, model=model.name, input_=options)
        validators = {"openai": validate_openai_video_options, "vidu": validate_vidu_video_options,
                      "kling": validate_kling_video_options, "volcengine": validate_volcengine_video_options}
        validators[model.provider_key](options)
    except ValueError as error:
        raise UnitVideoInputError('generation', str(error)) from error
    return media
