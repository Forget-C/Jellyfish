"""接缝只在直接相接的真实片段之间成立，局部结论不随无关片段改变。"""
from datetime import UTC
from uuid import uuid4

from sqlalchemy import select

from app.core.contracts.directing.scene_seam_review import SceneSeamReviewCreate, SceneSeamReviewRead
from app.core.contracts.directing.scene_version import SceneVersionContent
from app.models.directing import SceneSeamReviewRecord
from app.models.studio import Chapter
from app.services.directing.store import DirectingStore, RevisionConflict
from app.services.directing.seam_basis import scene_seam_basis, seam_review_query




class SceneSeamReviewService(DirectingStore):
    """固定局部人工审查；不自动换采用、提取参考或触发返工。"""

    @staticmethod
    def _read(row, current):
        request = SceneSeamReviewCreate.model_validate(row.review)
        content = SceneVersionContent.model_validate(row.content)
        original = scene_seam_basis(content, request.left_clip_id, request.right_clip_id)
        if original is None:
            raise ValueError('固定接缝依据无效，请核对原记录')
        return SceneSeamReviewRead(id=row.id, version_id=row.version_id, request_id=row.request_id,
            revision=request.expected_revision, left_clip_id=request.left_clip_id, right_clip_id=request.right_clip_id,
            decision=request.decision, content=content,
            created_at=row.created_at.replace(tzinfo=UTC) if row.created_at.tzinfo is None else row.created_at,
            matches_current=original == scene_seam_basis(current, request.left_clip_id, request.right_clip_id))

    async def list_seam_reviews(self, sequence_id, version_id):
        """按目标版本读取全部历史接缝证据，失效记录仍可追溯。"""
        version = await self.read_scene_version(sequence_id, version_id)
        inherited = await self.inherited_scene_review_ids(version_id, 'seam')
        rows = await self.db.scalars(seam_review_query(version_id, inherited))
        return [self._read(row, version.content) for row in rows]

    async def create_seam_review(self, sequence_id, version_id, body):
        """原请求优先核实，随后校验当前修订和直接相接关系，固定完整证据。"""
        sequence = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        version = await self.read_scene_version(sequence_id, version_id)
        existing = await self.db.scalar(select(SceneSeamReviewRecord).where(
            SceneSeamReviewRecord.version_id == version_id, SceneSeamReviewRecord.request_id == body.request_id))
        if existing is not None:
            if SceneSeamReviewCreate.model_validate(existing.review) != body:
                raise RevisionConflict('接缝审查请求身份已用于另一份结论')
            return self._read(existing, version.content)
        await self.current_sequence(sequence_id)
        if version.revision != body.expected_revision:
            raise RevisionConflict('方案已变化，请重新保存并审阅原接缝')
        if scene_seam_basis(version.content, body.left_clip_id, body.right_clip_id) is None:
            raise ValueError('所选片段未直接相接，或包含待拍占位；不能作为真实接缝审查')
        await self.validate_scene_content(sequence, version.content, previous=version.content)
        row = SceneSeamReviewRecord(id=uuid4().hex, version_id=version_id, request_id=body.request_id,
            review=body.model_dump(mode='json'), content=version.content.model_dump(mode='json'))
        self.db.add(row)
        await self.protect_scene_review_files(sequence, row.content, 'scene-seam-review:' + row.id)
        await self.db.flush()
        return self._read(row, version.content)
