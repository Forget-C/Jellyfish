"""统一生成提交服务的最小行为覆盖。"""

from __future__ import annotations

from typing import Any

import pytest

from app.core.contracts.generation import (
    GenerationCommand,
    GenerationDelivery,
    GenerationModality,
    GenerationOperation,
    GenerationSubmitRequest,
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.media import ImageMediaInput, MediaReference
from app.models.generation_artifacts import GenerationDispatchOutbox, GenerationTaskMediaReference
from app.models.task import GenerationTask, GenerationTaskVisibility
from app.models.task_links import GenerationTaskLink
from app.models.studio import FileItem, FileType
from app.services.generation.submission import (
    GenerationSubmitter,
    UnsupportedGenerationDeliveryError,
    generation_capability_registry,
)


class RecordingSession:
    """仅记录 ORM 新增对象的会话替身，用于验证服务的写入边界。"""

    def __init__(self) -> None:
        self.added: list[object] = []
        self.flush_count = 0
        self.files = {
            "file-1": FileItem(
                id="file-1",
                type=FileType.image,
                name="reference",
                thumbnail="",
                tags=[],
                storage_key="files/file-1",
                content_version=3,
                content_hash="sha256:stable",
            )
        }

    async def get(self, _model: object, file_id: str) -> FileItem | None:
        """提供媒体快照冻结所需的最小文件读取能力。"""
        return self.files.get(file_id)

    def add(self, instance: object) -> None:
        """记录待写入对象。"""
        self.added.append(instance)

    async def flush(self) -> None:
        """模拟同一事务内的 flush。"""
        self.flush_count += 1


class FixedGate:
    """返回固定冻结快照，避免提交服务测试依赖实体图。"""

    async def validate(self, _db: Any, command: GenerationCommand) -> ResolvedGenerationSnapshot:
        """根据命令生成不含 URL 或凭据的最小快照。"""
        return ResolvedGenerationSnapshot(
            model_id="model-1",
            model_revision_id="revision-1",
            canonical_target=command.target,
            media=command.request.media,
            operation_input=command.request.operation_input,
            execution_prompt=command.request.execution_prompt,
            credential_ref="credential-reference-must-not-persist",
        )


def _image_command(*, delivery: GenerationDelivery = GenerationDelivery.async_polling) -> GenerationCommand:
    """构建图片异步任务的固定内部命令。"""
    return GenerationCommand(
        modality=GenerationModality.image,
        operation=GenerationOperation.image_generation,
        delivery=delivery,
        target=GenerationTarget(kind=GenerationTargetKind.asset_image_slot, entity_id="asset-1", slot_id="slot-1"),
        request=GenerationSubmitRequest(
            model_id="model-1",
            execution_prompt="一只水母",
            media=ImageMediaInput(references=[MediaReference(file_id="file-1", media_kind="image")]),
            operation_input=ImageGenerationOperationInput(),
        ),
    )


def test_capability_registry_exposes_only_planned_matrix() -> None:
    """图片不允许 inline，文本聊天仍允许 streaming。"""
    assert not generation_capability_registry.supports(
        operation=GenerationOperation.image_generation,
        delivery=GenerationDelivery.inline,
    )
    assert generation_capability_registry.supports(
        operation=GenerationOperation.text_chat,
        delivery=GenerationDelivery.streaming,
    )


@pytest.mark.asyncio
async def test_async_submit_persists_task_link_media_and_outbox_without_secrets() -> None:
    """异步提交在同一会话写齐四类记录，payload 仅包含安全快照。"""
    db = RecordingSession()
    accepted = await GenerationSubmitter(entity_gate=FixedGate()).submit_async(db, _image_command())  # type: ignore[arg-type]

    assert accepted.task_id
    assert db.flush_count == 1
    task = next(item for item in db.added if isinstance(item, GenerationTask))
    link = next(item for item in db.added if isinstance(item, GenerationTaskLink))
    media = next(item for item in db.added if isinstance(item, GenerationTaskMediaReference))
    outbox = next(item for item in db.added if isinstance(item, GenerationDispatchOutbox))
    assert task.id == link.task_id == media.task_id == outbox.task_id == accepted.task_id
    assert task.visibility is GenerationTaskVisibility.task_center
    assert link.relation_type == "asset_image_slot"
    assert link.relation_entity_id == "slot-1"
    assert media.group_path == "references"
    assert media.file_content_version == 3
    assert media.file_content_hash == "sha256:stable"
    assert task.payload.keys() == {"command", "snapshot"}
    assert "credential_ref" not in task.payload["snapshot"]
    assert "storage_key" not in str(task.payload)
    assert "https://" not in str(task.payload)


@pytest.mark.asyncio
async def test_async_submit_rejects_unsupported_delivery_before_writing() -> None:
    """不支持的组合必须在门禁和写入前失败。"""
    db = RecordingSession()

    with pytest.raises(UnsupportedGenerationDeliveryError, match="delivery_unsupported"):
        await GenerationSubmitter(entity_gate=FixedGate()).submit_async(
            db, _image_command(delivery=GenerationDelivery.inline)  # type: ignore[arg-type]
        )

    assert db.added == []
