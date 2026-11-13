"""校验生成请求，并通过唯一任务维护入口提交执行。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import FrozenGenerationConfig, GenerationCommand, GenerationDelivery, ResolvedGenerationSnapshot
from app.core.contracts.task import TaskExecutionMode
from app.models.llm import Model, ModelCategoryKey, Provider
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.generation.submission.capabilities import GenerationCapabilityRegistry, generation_capability_registry
from app.services.generation.task_snapshot import split_snapshot
from app.services.task_service import TaskService
from app.services.task_sources import resolve_task_sources


class GenerationEntityGate(Protocol):
    """校验命令中的实体与媒体，并生成不携带 ORM 实体的输入快照。"""

    async def validate(self, db: AsyncSession, command: GenerationCommand) -> ResolvedGenerationSnapshot:
        """返回已验证的生成输入。"""


@dataclass(frozen=True)
class GenerationAccepted:
    """调用方以任务 ID 查询进度和历史结果。"""

    task_id: str


class GenerationSubmitter:
    """只负责生成请求校验与输入编排，任务生命周期由 TaskService 管理。"""

    def __init__(
        self, *, entity_gate: GenerationEntityGate,
        capability_registry: GenerationCapabilityRegistry = generation_capability_registry,
    ) -> None:
        """注入实体门禁和允许的生成组合。"""
        self._entity_gate = entity_gate
        self._capability_registry = capability_registry

    async def submit_async(self, db: AsyncSession, command: GenerationCommand, *, retry_of_task_id: str | None = None) -> GenerationAccepted:
        """在调用方事务中创建任务与输入关系，不额外维护投递表或执行状态。"""
        self._capability_registry.require_supported(
            operation=command.operation, delivery=command.delivery, target_kind=command.target.kind,
        )
        if command.delivery is not GenerationDelivery.async_polling:
            raise ValueError("submit_async requires async_polling delivery")
        snapshot = await self._entity_gate.validate(db, command)
        return await self.persist_async_task(db=db, command=command, snapshot=snapshot, retry_of_task_id=retry_of_task_id)

    async def persist_async_task(
        self, *, db: AsyncSession, command: GenerationCommand, snapshot: ResolvedGenerationSnapshot, retry_of_task_id: str | None = None,
    ) -> GenerationAccepted:
        """媒体任务受理时冻结有效执行配置；保留画布运行已固定的更早依据。"""
        frozen = snapshot.execution_config
        if frozen:
            model_name, provider_id, provider_key = frozen.model_name, frozen.provider_id, frozen.provider_key
        else:
            model = await db.get(Model, snapshot.model_id)
            provider = await db.get(Provider, model.provider_id) if model is not None else None
            if model is None or provider is None:
                raise HTTPException(status_code=422, detail="generation_model_unavailable")
            config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey(command.modality.value))
            model_name, provider_id, provider_key = model.name, provider.id, config.provider_key
            if command.modality.value in {"image", "video"}:
                frozen = FrozenGenerationConfig(model_name=model.name, model_params=model.params or {},
                    provider_id=provider.id, provider_key=config.provider_key, api_key=config.api_key, base_url=config.base_url)
                snapshot = snapshot.model_copy(update={"execution_config": frozen})
        mode = TaskExecutionMode.direct
        if command.operation.value == "video_generation" or (
            command.operation.value == "image_generation" and provider_key in {"vidu", "kling"}
        ):
            mode = TaskExecutionMode.remote
        data, target_type, target_id, inputs = split_snapshot(snapshot)
        data.update(model_name=model_name, provider_key=provider_key)
        kind = command.operation.value
        if kind == "text_agent":
            kind = {
                "check-consistency": "script_consistency",
                "analyze-character-portrait": "script_character_portrait", "analyze-prop-info": "script_prop_info",
                "analyze-scene-info": "script_scene_info", "analyze-costume-info": "script_costume_info",
                "optimize-script": "script_optimize", "simplify-script": "script_simplify",
            }[snapshot.operation_input.operation]
        source = (await resolve_task_sources(db, [SimpleNamespace(
            id="submission", target_type=target_type, target_id=target_id,
            target_parent_id=data.get("target_parent_id"), scene_version_id=None, scene_unit_id=None,
        )])).get("submission")
        task = await TaskService(db).submit(
            kind=kind, snapshot=data, title=kind, target_type=target_type, target_id=target_id,
            expected_target_version=snapshot.expected_version_id, provider_id=provider_id,
            execution_mode=mode, inputs=inputs, project_id=source.project_id if source else None, retry_of_task_id=retry_of_task_id,
        )
        if command.request.asset_references is not None:
            from app.services.studio.entity_specs import entity_spec
            from app.services.studio.resource_references import validate_resource_references
            spec = entity_spec(command.target.asset_type)
            asset = await db.get(spec.model, command.target.entity_id)
            await validate_resource_references(db, command.target.asset_type, asset.project_id,
                [ref.model_dump(exclude_none=True) for ref in command.request.asset_references], link=True)
        return GenerationAccepted(task_id=task.id)
