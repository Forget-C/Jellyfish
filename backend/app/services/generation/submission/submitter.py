"""统一生成提交骨架与异步任务的可靠持久化。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.core.contracts.generation import (
    GenerationCommand,
    GenerationDelivery,
    GenerationOperation,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.media import ImageMediaInput, MediaReference, VideoMediaInput
from app.models.generation_artifacts import GenerationDispatchOutbox, GenerationTaskMediaReference
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.models.task_links import GenerationTaskLink
from app.models.llm import Model, ModelCategoryKey, Provider
from app.core.contracts.provider_capabilities import provider_operation_capabilities
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.generation.files import FileResolver
from app.services.generation.submission.capabilities import GenerationCapabilityRegistry, generation_capability_registry
from app.services.generation.workflows import GenerationWorkflowSubmissionContext
from app.services.generation.workflows.defaults import generation_workflow_registry


class GenerationEntityGate(Protocol):
    """将命令中的 ID 校验并冻结为不携带 ORM 实体的执行快照。"""

    async def validate(self, db: AsyncSession, command: GenerationCommand) -> ResolvedGenerationSnapshot:
        """校验可信目标、模型和媒体关系并返回可序列化快照。"""


@dataclass(frozen=True)
class GenerationAccepted:
    """异步提交成功后的最小响应，调用方据此开始轮询。"""

    task_id: str


class GenerationSubmitter:
    """统一入口：先校验能力和实体，再按固定 delivery 分派。"""

    def __init__(
        self,
        *,
        entity_gate: GenerationEntityGate,
        capability_registry: GenerationCapabilityRegistry = generation_capability_registry,
    ) -> None:
        """注入门禁，保证路由不需要了解任务快照和落库细节。"""
        self._entity_gate = entity_gate
        self._capability_registry = capability_registry

    async def submit_async(self, db: AsyncSession, command: GenerationCommand) -> GenerationAccepted:
        """创建轮询任务、目标关联、媒体快照与 Outbox，并交由 dispatcher 投递。"""
        self._capability_registry.require_supported(
            operation=command.operation,
            delivery=command.delivery,
            target_kind=command.target.kind,
        )
        if command.delivery is not GenerationDelivery.async_polling:
            raise ValueError("submit_async requires async_polling delivery")
        handler = generation_workflow_registry.resolve(
            operation=command.operation,
            target_kind=command.target.kind,
        )
        await handler.validate_submission(GenerationWorkflowSubmissionContext(data={"db": db, "command": command}))
        snapshot = await self._entity_gate.validate(db, command)
        await _require_durable_media_recovery(db=db, command=command, snapshot=snapshot)
        return await self.persist_async_task(db=db, command=command, snapshot=snapshot)

    async def persist_async_task(
        self,
        *,
        db: AsyncSession,
        command: GenerationCommand,
        snapshot: ResolvedGenerationSnapshot,
    ) -> GenerationAccepted:
        """在调用方的同一数据库事务中写入任务、关联、媒体快照和 Outbox。"""
        task_id = uuid4().hex
        task = GenerationTask(
            id=task_id,
            mode=GenerationDeliveryMode.async_polling,
            visibility=GenerationTaskVisibility.task_center,
            task_kind=command.operation.value,
            status=GenerationTaskStatus.pending,
            payload=_task_payload(command=command, snapshot=snapshot),
        )
        db.add(task)
        db.add(
            GenerationTaskLink(
                task_id=task_id,
                resource_type=command.modality.value,
                relation_type=snapshot.canonical_target.kind.value,
                relation_entity_id=snapshot.canonical_target.slot_id or snapshot.canonical_target.entity_id,
            )
        )
        file_resolver = FileResolver(db)
        for group_path, reference in _iter_media_references(snapshot.media):
            media_snapshot = await file_resolver.snapshot(reference)
            db.add(
                GenerationTaskMediaReference(
                    task_id=task_id,
                    file_id=reference.file_id,
                    group_path=group_path,
                    ordinal=reference.ordinal,
                    media_kind=reference.media_kind,
                    file_content_version=media_snapshot.file_content_version,
                    file_content_hash=media_snapshot.file_content_hash,
                )
            )
        db.add(GenerationDispatchOutbox(task_id=task_id, payload={"task_id": task_id}))
        await db.flush()
        return GenerationAccepted(task_id=task_id)


def _task_payload(*, command: GenerationCommand, snapshot: ResolvedGenerationSnapshot) -> dict[str, object]:
    """保存任务输入快照；模型与供应商配置由 Worker 在执行期动态解析。"""
    return {
        "command": command.model_dump(mode="json"),
        "snapshot": snapshot.model_dump(mode="json"),
    }


async def _require_durable_media_recovery(
    *, db: AsyncSession, command: GenerationCommand, snapshot: ResolvedGenerationSnapshot
) -> None:
    """拒绝无法用远端 receipt 重取结果的 durable 媒体 Provider。

    P3 的物化 outbox 只保存 ProviderOperation receipt，不能保存临时 URL 或结果正文。
    因此图片、视频任务必须在提交期确认当前 Provider 同时具备远端句柄、单次 poll
    和按句柄重取结果能力，避免先创建不可恢复的远端任务。
    """
    if command.operation not in {GenerationOperation.image_generation, GenerationOperation.video_generation}:
        return
    model = await db.get(Model, snapshot.model_id)
    expected_category = (
        ModelCategoryKey.image
        if command.operation is GenerationOperation.image_generation
        else ModelCategoryKey.video
    )
    if model is None or model.category != expected_category:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="generation model is unavailable")
    provider = await db.get(Provider, model.provider_id)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="generation provider is unavailable")
    resolved = resolve_provider_config_from_provider(provider=provider, category=expected_category)
    capabilities = provider_operation_capabilities(
        provider_key=resolved.provider_key,
        operation_kind=command.operation.value,
    )
    if (
        not capabilities.supports_remote_handle
        or not capabilities.supports_poll_by_handle
        or not capabilities.supports_result_retrieval_by_handle
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "durable media generation requires a provider with a recoverable remote receipt; "
                f"provider={resolved.provider_key} operation={command.operation.value} is not supported"
            ),
        )


def _iter_media_references(media: ImageMediaInput | VideoMediaInput | None) -> list[tuple[str, MediaReference]]:
    """将强类型媒体树投影为持久化媒体快照所需的稳定 group_path。"""
    if media is None:
        return []
    if isinstance(media, ImageMediaInput):
        return [("references", reference) for reference in media.references]

    references: list[tuple[str, MediaReference]] = []
    if media.frames.first:
        references.append(("frames.first", media.frames.first))
    if media.frames.last:
        references.append(("frames.last", media.frames.last))
    references.extend(("frames.keys", reference) for reference in media.frames.keys)
    for subject in media.subjects:
        references.extend((f"subjects.{subject.name}", reference) for reference in subject.media)
    return references
