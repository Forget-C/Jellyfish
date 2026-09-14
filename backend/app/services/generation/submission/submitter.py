"""校验生成请求，并通过唯一任务维护入口提交执行。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import GenerationCommand, GenerationDelivery, ResolvedGenerationSnapshot
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

    async def submit_async(self, db: AsyncSession, command: GenerationCommand) -> GenerationAccepted:
        """在调用方事务中创建任务与输入关系，不额外维护投递表或执行状态。"""
        self._capability_registry.require_supported(
            operation=command.operation, delivery=command.delivery, target_kind=command.target.kind,
        )
        if command.delivery is not GenerationDelivery.async_polling:
            raise ValueError("submit_async requires async_polling delivery")
        snapshot = await self._entity_gate.validate(db, command)
        return await self.persist_async_task(db=db, command=command, snapshot=snapshot)

    async def persist_async_task(
        self, *, db: AsyncSession, command: GenerationCommand, snapshot: ResolvedGenerationSnapshot,
    ) -> GenerationAccepted:
        """冻结模型路由身份；凭据仍在执行期解析，媒体引用只存在于 task_inputs。"""
        model = await db.get(Model, snapshot.model_id)
        provider = await db.get(Provider, model.provider_id) if model is not None else None
        if model is None or provider is None:
            raise HTTPException(status_code=422, detail="generation_model_unavailable")
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey(command.modality.value))
        mode = TaskExecutionMode.direct
        if command.operation.value == "video_generation" or (
            command.operation.value == "image_generation" and config.provider_key in {"vidu", "kling"}
        ):
            mode = TaskExecutionMode.remote
        data, target_type, target_id, inputs = split_snapshot(snapshot)
        data.update(model_name=model.name, provider_key=config.provider_key)
        kind = command.operation.value
        if kind == "text_agent":
            kind = {
                "divide": "script_divide", "extract": "script_extract", "merge-entities": "script_merge",
                "check-consistency": "script_consistency", "analyze-variants": "script_variant",
                "analyze-character-portrait": "script_character_portrait", "analyze-prop-info": "script_prop_info",
                "analyze-scene-info": "script_scene_info", "analyze-costume-info": "script_costume_info",
                "optimize-script": "script_optimize", "simplify-script": "script_simplify",
            }[snapshot.operation_input.operation]
        source = (await resolve_task_sources(db, [SimpleNamespace(
            id="submission", target_type=target_type, target_id=target_id,
            target_parent_id=data.get("target_parent_id"),
        )])).get("submission")
        task = await TaskService(db).submit(
            kind=kind, snapshot=data, title=kind, target_type=target_type, target_id=target_id,
            expected_target_version=snapshot.expected_version_id, provider_id=provider.id,
            execution_mode=mode, inputs=inputs, project_id=source.project_id if source else None,
        )
        return GenerationAccepted(task_id=task.id)
