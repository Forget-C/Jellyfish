"""统一生成提交骨架与异步任务的可靠持久化。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import (
    GenerationCommand,
    GenerationDelivery,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.media import ImageMediaInput, MediaReference, VideoMediaInput
from app.models.generation_artifacts import GenerationDispatchOutbox, GenerationTaskMediaReference
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.models.task_links import GenerationTaskLink
from app.services.generation.submission.capabilities import GenerationCapabilityRegistry, generation_capability_registry


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
        self._capability_registry.require_supported(operation=command.operation, delivery=command.delivery)
        if command.delivery is not GenerationDelivery.async_polling:
            raise ValueError("submit_async requires async_polling delivery")
        snapshot = await self._entity_gate.validate(db, command)
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
        for group_path, reference in _iter_media_references(snapshot.media):
            db.add(
                GenerationTaskMediaReference(
                    task_id=task_id,
                    file_id=reference.file_id,
                    group_path=group_path,
                    ordinal=reference.ordinal,
                    media_kind=reference.media_kind,
                )
            )
        db.add(GenerationDispatchOutbox(task_id=task_id, payload={"task_id": task_id}))
        await db.flush()
        return GenerationAccepted(task_id=task_id)


def _task_payload(*, command: GenerationCommand, snapshot: ResolvedGenerationSnapshot) -> dict[str, object]:
    """仅冻结 command 与可安全重放的 snapshot，排除凭据引用等执行期材料。"""
    return {
        "command": command.model_dump(mode="json"),
        "snapshot": snapshot.model_dump(mode="json", exclude={"credential_ref"}),
    }


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
