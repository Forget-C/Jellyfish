"""统一生成结果发布器的共享 CAS 与 Artifact 状态逻辑。"""

from __future__ import annotations

from abc import ABC, abstractmethod

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import GenerationTargetKind, ResolvedGenerationSnapshot
from app.models.generation_artifacts import GenerationArtifact, GenerationArtifactPublishStatus


class GenerationResultPublisher(ABC):
    """将已归档的成功产物安全发布到一个明确的业务目标。"""

    target_kind: GenerationTargetKind

    async def publish_terminal(
        self,
        db: AsyncSession,
        *,
        snapshot: ResolvedGenerationSnapshot,
        artifacts: list[GenerationArtifact],
    ) -> None:
        """发布第一个产物，其他产物保留为可追溯历史记录。

        Publisher 只处理成功且已归档的文件产物；调用方在同一事务内处理
        任务成功、失败和取消终态。已经处于 published/conflicted 的主产物
        不会再次执行 CAS，保证重复 Worker 投递不会覆盖后来的版本。
        """
        self._require_target(snapshot)
        primary, secondary = self._partition_artifacts(artifacts)
        for artifact in secondary:
            self._mark_skipped(artifact, "non_primary_artifact")
        if primary is None or self._is_final_primary(primary):
            return
        if primary.file_id is None:
            raise ValueError("publisher requires a file artifact")

        expected_version_id = snapshot.expected_version_id
        if expected_version_id is None:
            raise ValueError("publisher requires expected_version_id")
        published = await self._publish_file(
            db,
            snapshot=snapshot,
            file_id=primary.file_id,
            expected_version_id=expected_version_id,
        )
        if published:
            primary.publish_status = GenerationArtifactPublishStatus.published
            primary.publish_error = None
        else:
            primary.publish_status = GenerationArtifactPublishStatus.conflicted
            primary.publish_error = "target_version_conflict"

    def _require_target(self, snapshot: ResolvedGenerationSnapshot) -> None:
        """阻止 Publisher 被错误的可信 target 调用。"""
        if snapshot.canonical_target.kind is not self.target_kind:
            raise ValueError("publisher target_kind mismatch")

    @staticmethod
    def _partition_artifacts(
        artifacts: list[GenerationArtifact],
    ) -> tuple[GenerationArtifact | None, list[GenerationArtifact]]:
        """按 ordinal 选择唯一主产物，并稳定处理所有历史产物。"""
        ordered = sorted(artifacts, key=lambda artifact: artifact.ordinal)
        primary = next((artifact for artifact in ordered if artifact.ordinal == 0), None)
        return primary, [artifact for artifact in ordered if artifact is not primary]

    @staticmethod
    def _is_final_primary(artifact: GenerationArtifact) -> bool:
        """识别已处理的主产物，确保重复发布不会重新执行过期 CAS。"""
        return artifact.publish_status in {
            GenerationArtifactPublishStatus.published,
            GenerationArtifactPublishStatus.conflicted,
        }

    @staticmethod
    def _mark_skipped(artifact: GenerationArtifact, reason: str) -> None:
        """为非主产物记录明确的未自动采用原因。"""
        if artifact.publish_status not in {
            GenerationArtifactPublishStatus.published,
            GenerationArtifactPublishStatus.conflicted,
        }:
            artifact.publish_status = GenerationArtifactPublishStatus.skipped
            artifact.publish_error = reason

    @abstractmethod
    async def _publish_file(
        self,
        db: AsyncSession,
        *,
        snapshot: ResolvedGenerationSnapshot,
        file_id: str,
        expected_version_id: int,
    ) -> bool:
        """对具体业务槽位执行带 expected_version_id 的单条 CAS 更新。"""

