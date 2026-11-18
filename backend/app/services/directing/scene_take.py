"""固定的 Take 复核依据。"""
from datetime import UTC

from sqlalchemy import or_, select

from app.core.contracts.directing.scene_take_review import SceneTakeReviewRead
from app.core.contracts.directing.scene_version import SceneVersionContent
from app.models.directing import SceneTakeReviewRecord
from app.models.studio import Chapter
from app.services.directing.store import DirectingStore, RevisionConflict
from app.services.directing.scene_take_evidence import take_review_matches


class SceneTakeService(DirectingStore):
    """读取和保存固定的 Take 复核记录。"""

    async def list_take_reviews(self, sequence_id, version_id):
        """读取固定审片依据，与当前已保存方案比较；不回写历史结论。"""
        version = await self.read_scene_version(sequence_id, version_id)
        inherited = await self.inherited_scene_review_ids(version_id, 'take')
        rows = await self.db.scalars(select(SceneTakeReviewRecord).where(or_(
            SceneTakeReviewRecord.version_id == version_id, SceneTakeReviewRecord.id.in_(inherited))).order_by(SceneTakeReviewRecord.created_at, SceneTakeReviewRecord.id))
        result = []
        for row in rows:
            content = SceneVersionContent.model_validate(row.content)
            result.append(SceneTakeReviewRead(id=row.id, version_id=row.version_id, revision=row.revision,
                take_kind=row.take_kind, take_id=row.take_id, content=content, created_at=row.created_at.replace(tzinfo=UTC) if row.created_at.tzinfo is None else row.created_at,
                matches_current=take_review_matches(content, version.content, row.take_kind, row.take_id)))
        return result

    async def confirm_take_review(self, sequence_id, version_id, body):
        """固定指定保存修订；响应未知重放只返回原记录，不重审后来内容。"""
        sequence = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        version = await self.read_scene_version(sequence_id, version_id)
        record = await self.db.scalar(select(SceneTakeReviewRecord).where(
            SceneTakeReviewRecord.version_id == version_id, SceneTakeReviewRecord.revision == body.expected_revision,
            SceneTakeReviewRecord.take_kind == body.take_kind, SceneTakeReviewRecord.take_id == body.take_id))
        if record is None:
            await self.current_sequence(sequence_id)
            if version.revision != body.expected_revision:
                raise RevisionConflict('方案已变化，请重新读取并明确核对当前依据')
            judgment = next((item for item in version.content.take_judgments
                if (item.take_kind, item.take_id) == (body.take_kind, body.take_id)), None)
            if judgment is None or judgment.annotation.review_status != 'reviewed':
                raise ValueError('请先保存该素材的明确审查结论')
            record = await self.create_scene_take_review(sequence, version_id, version.revision, version.content, judgment)
        return next(item for item in await self.list_take_reviews(sequence_id, version_id) if item.id == record.id)
