"""镜头帧与镜头视频 WorkflowHandler 的发布、状态刷新测试。"""

from __future__ import annotations

import pytest

from app.core.contracts.generation import ResolvedGenerationSnapshot
from app.core.contracts.generation_delivery import (
    DeliveredArtifactPublishState,
    GenerationDeliveryResult,
    GenerationOutcome,
)
from app.models.generation_artifacts import GenerationArtifact, GenerationArtifactPublishStatus
from app.services.generation.workflows.base import GenerationWorkflowTerminalContext
from app.services.generation.workflows.handlers import ShotFrameWorkflowHandler, ShotVideoWorkflowHandler


class _Publisher:
    """记录 CAS 发布调用的最小 Publisher 替身。"""

    def __init__(self) -> None:
        """初始化用于断言的调用记录。"""

        self.calls: list[tuple[object, ResolvedGenerationSnapshot, list[GenerationArtifact]]] = []

    async def publish_terminal(
        self,
        db: object,
        *,
        snapshot: ResolvedGenerationSnapshot,
        artifacts: list[GenerationArtifact],
    ) -> None:
        """记录调用，并模拟 Publisher 已将 Artifact 标记为发布成功。"""

        self.calls.append((db, snapshot, artifacts))
        artifacts[0].publish_status = GenerationArtifactPublishStatus.published
        artifacts[0].publish_error = None


def _artifact() -> GenerationArtifact:
    """构造可被镜头 Publisher 发布的主产物。"""

    return GenerationArtifact(
        id="artifact-1",
        task_id="task-1",
        modality="image",
        ordinal=0,
        file_id="file-1",
        provider_result={},
        publish_status=GenerationArtifactPublishStatus.skipped,
        publish_error="no_target_slot",
    )


def _snapshot(*, target_kind: str) -> ResolvedGenerationSnapshot:
    """构造镜头帧或镜头视频交付所需的最小冻结快照。"""

    operation_input = {"kind": "image_generation"} if target_kind == "shot_frame_slot" else {"kind": "video_generation", "ratio": "16:9"}
    payload = {
        "model_id": "model-1",
        "canonical_target": {"kind": target_kind, "entity_id": "shot-1", "slot_id": "9" if target_kind == "shot_frame_slot" else None},
        "expected_version_id": 1,
        "operation_input": operation_input,
        "execution_prompt": "生成镜头素材",
    }
    return ResolvedGenerationSnapshot.model_validate(payload)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handler_type", "target_kind"),
    [(ShotFrameWorkflowHandler, "shot_frame_slot"), (ShotVideoWorkflowHandler, "shot_video")],
)
async def test_shot_handlers_publish_then_refresh_matching_shot(monkeypatch, handler_type, target_kind: str) -> None:
    """两类镜头 Handler 必须调用各自 Publisher，并在成功后刷新同一镜头状态。"""

    publisher = _Publisher()
    refreshed: list[tuple[object, str]] = []

    async def _refresh(db: object, *, shot_id: str) -> None:
        """记录状态刷新调用，避免测试依赖镜头领域数据库。"""

        refreshed.append((db, shot_id))

    monkeypatch.setattr("app.services.generation.workflows.handlers.recompute_shot_status", _refresh)
    handler = handler_type(publisher=publisher)
    db = object()
    artifacts = [_artifact()]
    snapshot = _snapshot(target_kind=target_kind)

    result = await handler.deliver_success(
        GenerationWorkflowTerminalContext(task_id="task-1", data={"db": db, "snapshot": snapshot, "artifacts": artifacts})
    )

    assert publisher.calls == [(db, snapshot, artifacts)]
    assert refreshed == [(db, "shot-1")]
    assert isinstance(result, GenerationDeliveryResult)
    assert result.outcome is GenerationOutcome.succeeded
    assert result.primary_file_id == "file-1"
    assert result.artifacts[0].artifact_id == "artifact-1"
    assert result.artifacts[0].publish_state is DeliveredArtifactPublishState.published


@pytest.mark.asyncio
async def test_shot_frame_handler_rejects_wrong_target_before_publish_or_refresh(monkeypatch) -> None:
    """目标类型被篡改时不得发布或刷新，避免实验室目标触及镜头领域。"""

    publisher = _Publisher()
    refreshed: list[str] = []

    async def _refresh(_db: object, *, shot_id: str) -> None:
        """记录意外刷新，证明目标保护在发布前生效。"""

        refreshed.append(shot_id)

    monkeypatch.setattr("app.services.generation.workflows.handlers.recompute_shot_status", _refresh)
    handler = ShotFrameWorkflowHandler(publisher=publisher)

    with pytest.raises(ValueError, match="target_kind mismatch"):
        await handler.deliver_success(
            GenerationWorkflowTerminalContext(
                task_id="task-1",
                data={"db": object(), "snapshot": _snapshot(target_kind="shot_video"), "artifacts": [_artifact()]},
            )
        )

    assert publisher.calls == []
    assert refreshed == []
