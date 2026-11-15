"""统一生成实体门禁：将业务提交中的 ID 解析为可执行快照。"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.task import Task

from app.core.contracts.generation import (
    FrozenGenerationConfig,
    GenerationCommand,
    GenerationModality,
    GenerationTargetKind,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.media import ImageMediaInput, MediaReference, VideoMediaInput
from app.models.experiment_sessions import ExperimentSession
from app.models.directing import DirectingRevision, Sequence, SceneVideoExecution, SceneVersionRecord
from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider, ProviderStatus
from app.models.studio_prompts_files_timeline import FileItem
from app.models.types import FileType
from app.services.studio.entity_specs import entity_spec


def _iter_media(media: ImageMediaInput | VideoMediaInput | None) -> list[MediaReference]:
    """以稳定顺序摊平媒体结构，分组语义仍由原始强类型结构保留。"""
    if media is None:
        return []
    if isinstance(media, ImageMediaInput):
        return list(media.references)
    items = [reference for reference in [media.frames.first, media.frames.last] if reference]
    items.extend(media.frames.keys)
    for subject in media.subjects:
        items.extend(subject.media)
    return items



class GenerationEntityGate:
    """统一校验目标、模型和媒体引用，不解释用户编辑后的提示词。"""

    async def validate(self, db: AsyncSession, command: GenerationCommand) -> ResolvedGenerationSnapshot:
        """校验生成输入；画布沿用私有固定配置，其他媒体配置由提交器补齐。"""
        await self._validate_target(db, command)
        if command.request.asset_references is not None:
            if command.target.kind != GenerationTargetKind.asset_image_slot:
                raise HTTPException(400, "对象参考仅适用于对象图片生成")
            spec = entity_spec(command.target.asset_type)
            asset = await db.get(spec.model, command.target.entity_id)
            references = command.request.asset_references
            actual = {ref.file_id for ref in _iter_media(command.request.media)}
            if {ref.file_id for ref in references} != actual:
                raise HTTPException(400, "对象参考与实际生成图片不一致")
            from app.services.studio.resource_references import validate_resource_references
            await validate_resource_references(db, command.target.asset_type, asset.project_id,
                [ref.model_dump(exclude_none=True) for ref in references])
        frozen = None
        if command.target.kind == GenerationTargetKind.canvas_node:
            from app.models.generation_canvas import CanvasRunNode
            node = await db.get(CanvasRunNode, command.target.entity_id)
            private = node.execution_snapshot or {}
            if private.get('execution_config'):
                frozen = FrozenGenerationConfig.model_validate(private['execution_config'])
        model = None if frozen else await self._resolve_model(db, command)
        await self._validate_media(db, command.request.media)
        if frozen is None and command.target.kind == GenerationTargetKind.canvas_node:
            from app.services.llm.provider_resolver import resolve_provider_config_from_provider
            provider = await db.get(Provider, model.provider_id)
            cfg = resolve_provider_config_from_provider(provider=provider, category=model.category)
            frozen = FrozenGenerationConfig(model_name=model.name, model_params=model.params or {}, provider_id=provider.id,
                provider_key=cfg.provider_key, api_key=cfg.api_key, base_url=cfg.base_url)
        return ResolvedGenerationSnapshot(
            execution_config=frozen,
            model_id=command.request.model_id if frozen else model.id,
            prompt_revision_id=command.target.entity_id if command.target.kind == GenerationTargetKind.directing_unit else None,
            canonical_target=command.target,
            expected_version_id=await self._target_version(db, command),
            media=command.request.media,
            operation_input=command.request.operation_input,
            execution_prompt=command.request.execution_prompt,
            asset_prompt_audit=command.request.asset_prompt_audit,
            asset_references=command.request.asset_references,
        )

    async def _resolve_model(self, db: AsyncSession, command: GenerationCommand) -> Model:
        """选择可用模型并校验其当前 Provider，不冻结可变执行配置。"""
        model_id = command.request.model_id or await self._default_model_id(db, command.modality)
        model = await db.get(Model, model_id) if model_id else None
        expected_category = ModelCategoryKey(command.modality.value)
        if model is None or model.category != expected_category:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="model_unavailable")
        provider = await db.get(Provider, model.provider_id)
        if provider is None or provider.status == ProviderStatus.disabled:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="model_unavailable")
        return model

    async def _default_model_id(self, db: AsyncSession, modality: GenerationModality) -> str | None:
        """按模态读取唯一默认模型；不存在时由统一错误语义处理。"""
        settings = await db.get(ModelSettings, 1)
        if settings is None:
            return None
        return {
            GenerationModality.text: settings.default_text_model_id,
            GenerationModality.image: settings.default_image_model_id,
            GenerationModality.video: settings.default_video_model_id,
        }[modality]

    async def _validate_media(self, db: AsyncSession, media: ImageMediaInput | VideoMediaInput | None) -> None:
        """验证每个 file_id 存在且声明 media_kind 与 FileItem.type 一致。"""
        for reference in _iter_media(media):
            file_item = await db.get(FileItem, reference.file_id)
            expected_type = FileType.image if reference.media_kind == "image" else FileType.video
            if file_item is None or file_item.delete_requested_at is not None or file_item.deleted_at is not None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="file_not_found")
            if file_item.type != expected_type:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="media_role_invalid")

    async def _validate_target(self, db: AsyncSession, command: GenerationCommand) -> None:
        """按封闭 target kind 验证目标/槽位存在，避免 Worker 再猜测业务关系。"""
        target = command.target
        exists = False
        if target.kind == GenerationTargetKind.canvas_node:
            from app.models.generation_canvas import CanvasRunNode
            node = await db.get(CanvasRunNode, target.entity_id)
            exists = node is not None and node.status == "queued"
        elif target.kind == GenerationTargetKind.experiment_session:
            session = await db.get(ExperimentSession, target.entity_id, with_for_update=True)
            exists = session is not None
            if session is not None and session.lab_type != command.modality.value:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="experiment_session_type_invalid")
        elif target.kind == GenerationTargetKind.directing_image:
            revision = await db.get(DirectingRevision, target.entity_id)
            exists = revision is not None and revision.kind == "design" and revision.confirmed_at is not None
        elif target.kind == GenerationTargetKind.directing_unit:
            revision = await db.get(DirectingRevision, target.entity_id)
            exists = revision is not None and revision.kind == "prompt" and revision.confirmed_at is not None
        elif target.kind == GenerationTargetKind.scene_video:
            execution = await db.get(SceneVideoExecution, target.entity_id)
            version = await db.get(SceneVersionRecord, execution.version_id) if execution else None
            sequence = await db.get(Sequence, version.sequence_id, with_for_update=True, populate_existing=True) if version else None
            exists = sequence is not None
            if sequence is not None and not sequence.is_current:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="场次已退出当前划分，不能发起生成")
            if execution and execution.preparation['request'] != command.request.model_dump(mode='json'):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="执行输入与固定视频记录不一致")
        elif target.kind == GenerationTargetKind.asset_image_slot:
            exists = target.slot_id is not None and await self._asset_slot_belongs_to(
                db,
                slot_id=target.slot_id,
                entity_id=target.entity_id,
                asset_type=target.asset_type,
            )
            if exists:
                if getattr(command.request.operation_input, "save_as_candidate", False):
                    raise HTTPException(422, "对象生成直接新增图片，不支持新的候选生成")
                spec = entity_spec(target.asset_type)
                row = await db.get(spec.image_model, int(target.slot_id))
                previous = await db.scalar(select(Task.id).where(
                    Task.target_type == f"{target.asset_type}_image_slot",
                    Task.target_id == str(target.slot_id),
                ).limit(1))
                if row.file_id or previous is not None:
                    raise HTTPException(409, "每次生成必须使用新的空图片记录")
        elif target.kind == GenerationTargetKind.script_processing:
            exists = bool(target.entity_id)
        if exists and target.kind in (GenerationTargetKind.directing_image, GenerationTargetKind.directing_unit):
            sequence = await db.get(Sequence, revision.sequence_id, with_for_update=True, populate_existing=True)
            if sequence is None or not sequence.is_current:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="场次已退出当前划分，不能发起生成")
        if not exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")

    async def _asset_slot_belongs_to(self, db: AsyncSession, *, slot_id: str, entity_id: str, asset_type: str) -> bool:
        """确认资产图片槽位存在且属于路径绑定的资产，拒绝跨资产写回。"""
        try:
            numeric_id = int(slot_id)
        except ValueError:
            return False
        spec = entity_spec(asset_type)
        await db.get(spec.model, entity_id, with_for_update=True)
        row = await db.get(spec.image_model, numeric_id)
        return row is not None and getattr(row, spec.id_field) == entity_id

    async def _target_version(self, db: AsyncSession, command: GenerationCommand) -> int | None:
        """提交时冻结可发布槽位的当前 CAS 版本，实验与脚本目标不需要版本。"""
        target = command.target
        if target.kind == GenerationTargetKind.directing_unit:
            revision = await db.get(DirectingRevision, target.entity_id)
            return revision.version if revision else None
        if target.kind == GenerationTargetKind.asset_image_slot and target.slot_id:
            numeric_id = int(target.slot_id)
            spec = entity_spec(target.asset_type)
            row = await db.get(spec.image_model, numeric_id)
            return row.version_id if row is not None else None
        return None
