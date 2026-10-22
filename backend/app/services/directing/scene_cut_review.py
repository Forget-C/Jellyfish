"""整场验收固定保存真实内容，适用性独立于可变版本名称和任务状态。"""
from datetime import UTC
from uuid import uuid4

from sqlalchemy import select

from app.core.contracts.directing.scene_cut_review import SceneCutReviewCreate, SceneCutReviewRead
from app.core.contracts.directing.scene_version import SceneVersionContent
from app.models.directing import SceneCutReviewRecord
from app.models.studio import Chapter
from app.services.directing.store import DirectingStore, RevisionConflict
from app.services.directing.scene_cut_evidence import scene_cut_review_basis, cut_review_query, cut_review_basis_key


class SceneCutReviewService(DirectingStore):
    """人工审片与保存、采用、生成分开；未知响应只能重放原授权。"""

    @staticmethod
    def _read(row, current):
        request = SceneCutReviewCreate.model_validate(row.review)
        content = SceneVersionContent.model_validate(row.content)
        return SceneCutReviewRead(id=row.id, version_id=row.version_id, request_id=row.request_id,
            revision=request.expected_revision, decision=request.decision, content=content,
            created_at=row.created_at.replace(tzinfo=UTC) if row.created_at.tzinfo is None else row.created_at,
            matches_current=scene_cut_review_basis(content) == scene_cut_review_basis(current))

    async def list_cut_reviews(self, sequence_id, version_id):
        """保留所有历史依据，当前适用性按实际内容计算。"""
        version = await self.read_scene_version(sequence_id, version_id)
        inherited = await self.inherited_scene_review_ids(version_id, 'cut')
        rows = await self.db.scalars(cut_review_query(version_id, inherited).order_by(None).order_by(SceneCutReviewRecord.created_at, SceneCutReviewRecord.id))
        return [self._read(row, version.content) for row in rows]

    async def create_cut_review(self, sequence_id, version_id, body):
        """先核实幂等身份，再校验当前修订与真实引用，事务内固定结论和文件保护。"""
        sequence = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        version = await self.read_scene_version(sequence_id, version_id)
        existing = await self.db.scalar(select(SceneCutReviewRecord).where(
            SceneCutReviewRecord.version_id == version_id, SceneCutReviewRecord.request_id == body.request_id))
        if existing is not None:
            if SceneCutReviewCreate.model_validate(existing.review) != body:
                raise RevisionConflict('审片请求身份已用于另一份结论')
            return self._read(existing, version.content)
        await self.current_sequence(sequence_id)
        if version.revision != body.expected_revision:
            raise RevisionConflict('方案已变化，请重新保存并审阅当前剪辑')
        await self.validate_scene_content(sequence, version.content, previous=version.content)
        items = version.content.timeline.items
        if not items:
            raise ValueError('空时间线尚无可审阅内容')
        if body.decision.coverage_status == 'verified' and any(item.kind == 'planned' for item in items):
            raise ValueError('待拍占位不是实际覆盖，请将覆盖核对标为缺口或未核实')
        clip_ids = {item.id for item in items}
        if any(set(issue.clip_ids) - clip_ids for issue in body.decision.issues):
            raise ValueError('审片问题须定位当前时间线中的真实片段身份')
        row = SceneCutReviewRecord(id=uuid4().hex, version_id=version_id, request_id=body.request_id,
            review=body.model_dump(mode='json'), content=version.content.model_dump(mode='json'),
            basis_key=cut_review_basis_key(version.content))
        self.db.add(row)
        await self.protect_scene_review_files(sequence, row.content, 'scene-cut-review:' + row.id)
        await self.db.flush()
        return self._read(row, version.content)
