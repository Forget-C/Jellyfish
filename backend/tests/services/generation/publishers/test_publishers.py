"""业务 Publisher 的 CAS 发布与多产物状态覆盖。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.contracts.generation import (
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.models.task import TaskOutput
from app.services.generation.publishers import AssetImagePublisher, ShotFramePublisher, ShotVideoPublisher


class RecordingSession:
    """记录 Publisher 发出的 CAS 语句，并按测试指定结果返回 rowcount。"""

    def __init__(self, *rowcounts: int) -> None:
        """按执行顺序提供 SQL 更新影响行数。"""
        self._rowcounts = list(rowcounts)
        self.statements: list[object] = []

    async def get(self, model, file_id, **kwargs):
        """模拟可用文件；真实文件删除与采用冲突另由数据库集成测试验证。"""
        return SimpleNamespace(id=file_id, delete_requested_at=None, deleted_at=None)

    async def execute(self, statement: object) -> SimpleNamespace:
        """模拟 AsyncSession.execute 的 rowcount 返回值。"""
        self.statements.append(statement)
        return SimpleNamespace(rowcount=self._rowcounts.pop(0))


def _snapshot(kind: GenerationTargetKind, *, entity_id: str = "shot-1", slot_id: str | None = "12") -> ResolvedGenerationSnapshot:
    """创建包含目标版本的最小图片任务快照。"""
    return ResolvedGenerationSnapshot(
        model_id="model-1",
        canonical_target=GenerationTarget(kind=kind, entity_id=entity_id, slot_id=slot_id, asset_type="actor" if kind == GenerationTargetKind.asset_image_slot else None),
        expected_version_id=3,
        operation_input=ImageGenerationOperationInput(),
    )


def _artifact(ordinal: int) -> TaskOutput:
    """创建待发布的任务输出，不再维护独立 Artifact 状态模型。"""
    return TaskOutput(task_id="task-1", ordinal=ordinal, file_id=f"file-{ordinal}")


@pytest.mark.asyncio
async def test_asset_publisher_publishes_primary_and_keeps_secondary_as_history() -> None:
    """资产主产物 CAS 成功，非主产物不自动覆盖同一个槽位。"""
    db = RecordingSession(1)
    primary, secondary = _artifact(0), _artifact(1)

    await AssetImagePublisher().publish_terminal(
        db, snapshot=_snapshot(GenerationTargetKind.asset_image_slot), artifacts=[secondary, primary]  # type: ignore[arg-type]
    )

    assert len(db.statements) == 1
    assert primary.delivery_status == "published"
    assert primary.delivery_reason is None
    assert secondary.delivery_status == "skipped"
    assert secondary.delivery_reason == "non_primary_artifact"
    assert "version_id" in str(db.statements[0])
    assert "file_id" in str(db.statements[0])


@pytest.mark.asyncio
async def test_shot_frame_publisher_marks_conflict_without_overwriting_slot() -> None:
    """帧槽位 CAS 未命中时保留 Artifact，并暴露固定冲突码。"""
    db = RecordingSession(0)
    primary = _artifact(0)

    await ShotFramePublisher().publish_terminal(
        db, snapshot=_snapshot(GenerationTargetKind.shot_frame_slot), artifacts=[primary]  # type: ignore[arg-type]
    )

    assert len(db.statements) == 1
    assert primary.delivery_status == "conflicted"
    assert primary.delivery_reason == "target_version_conflict"
    assert "shot_frame_images" in str(db.statements[0])


@pytest.mark.asyncio
async def test_shot_video_publisher_uses_dedicated_video_version_and_is_idempotent() -> None:
    """视频发布不改 shot.status，重复调用不会对已发布 Artifact 再执行 CAS。"""
    db = RecordingSession(1)
    primary = _artifact(0)
    publisher = ShotVideoPublisher()
    snapshot = _snapshot(GenerationTargetKind.shot_video, entity_id="shot-42", slot_id=None)

    await publisher.publish_terminal(db, snapshot=snapshot, artifacts=[primary])  # type: ignore[arg-type]
    await publisher.publish_terminal(db, snapshot=snapshot, artifacts=[primary])  # type: ignore[arg-type]

    assert len(db.statements) == 1
    assert primary.delivery_status == "published"
    statement = str(db.statements[0])
    assert "generated_video_file_id" in statement
    assert "generated_video_version_id" in statement
    assert "status" not in statement


@pytest.mark.asyncio
async def test_frame_publisher_rejects_wrong_target_before_database_write():
    """目标类型不匹配时不能把实验或视频结果写入帧槽位。"""
    db = RecordingSession(1)
    with pytest.raises(ValueError, match="target_kind mismatch"):
        await ShotFramePublisher().publish_terminal(
            db, snapshot=_snapshot(GenerationTargetKind.shot_video), artifacts=[_artifact(0)],
        )
    assert db.statements == []
