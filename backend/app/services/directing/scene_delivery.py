"""章节使用由明确交付固定，普通编辑和历史请求核实不替换当前指向。"""
from datetime import UTC
from uuid import uuid4

from sqlalchemy import or_, select

from app.core.contracts.directing.scene_delivery import ChapterDeliveriesRead, ChapterSceneDelivery, SceneDeliveryRead
from app.core.contracts.directing.scene_cut_review import SceneCutReviewCreate
from app.core.contracts.directing.scene_version import SceneVersionContent
from app.models.directing import SceneCutReviewRecord, SceneDeliveryRecord, SceneDeliveryUse
from app.models.studio import Chapter
from app.services.directing.scene_cut_review import scene_cut_review_basis
from app.services.directing.scene_take import SceneTakeService
from app.services.directing.store import RevisionConflict
from app.services.directing.workspace import WorkspaceService


class SceneDeliveryService(SceneTakeService):
    """固定内容、真实来源和当时适用审片，不把交付当成验收或导出。"""

    async def _delivery_read(self, row):
        content = SceneVersionContent.model_validate(row.content)
        adopted = {(item.take_kind, item.take_id, item.file_id) for item in content.timeline.items if item.kind == 'media'}
        takes = [take for take in await self.list_scene_takes(row.sequence_id, row.version_id)
            if (take.take_kind, take.take_id, take.file_id) in adopted] if adopted else []
        return SceneDeliveryRead(id=row.id, sequence_id=row.sequence_id, version_id=row.version_id,
            version_title=row.version_title, revision=row.revision, request_id=row.request_id,
            content=content, review_id=row.review_id, review=row.review, takes=takes,
            created_at=row.created_at.replace(tzinfo=UTC) if row.created_at.tzinfo is None else row.created_at)

    async def list_deliveries(self, sequence_id):
        """原场次交付历史保持可读，不按当前编辑推导新交付。"""
        await self.sequence(sequence_id)
        rows = await self.db.scalars(select(SceneDeliveryRecord).where(SceneDeliveryRecord.sequence_id == sequence_id)
            .order_by(SceneDeliveryRecord.created_at, SceneDeliveryRecord.id))
        return [await self._delivery_read(row) for row in rows]

    async def create_delivery(self, sequence_id, version_id, body):
        """锁定章节后核对保存修订，保护文件并原子替换章节使用指向。"""
        sequence = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        version = await self.read_scene_version(sequence_id, version_id)
        existing = await self.db.scalar(select(SceneDeliveryRecord).where(
            SceneDeliveryRecord.version_id == version_id, SceneDeliveryRecord.request_id == body.request_id))
        if existing is not None:
            if existing.revision != body.expected_revision:
                raise RevisionConflict('交付请求身份已用于另一份保存内容')
            return await self._delivery_read(existing)
        await self.current_sequence(sequence_id)
        if version.revision != body.expected_revision:
            raise RevisionConflict('保存修订已变化，请重新核对并明确更新到章节')
        if not version.content.timeline.items:
            raise ValueError('请先在时间线添加真实采用或待拍占位，再用于章节')
        await self.validate_scene_content(sequence, version.content, previous=version.content)
        review_id, review = None, None
        inherited = await self.inherited_scene_review_ids(version_id, 'cut')
        reviews = await self.db.scalars(select(SceneCutReviewRecord).where(or_(SceneCutReviewRecord.version_id == version_id, SceneCutReviewRecord.id.in_(inherited)))
            .order_by(SceneCutReviewRecord.created_at.desc(), SceneCutReviewRecord.id.desc()))
        for candidate in reviews:
            if scene_cut_review_basis(SceneVersionContent.model_validate(candidate.content)) == scene_cut_review_basis(version.content):
                review_id = candidate.id
                review = SceneCutReviewCreate.model_validate(candidate.review).decision.model_dump(mode='json')
                break
        row = SceneDeliveryRecord(id=uuid4().hex, sequence_id=sequence_id, version_id=version_id,
            request_id=body.request_id, revision=version.revision, version_title=version.title,
            content=version.content.model_dump(mode='json'), review_id=review_id, review=review)
        self.db.add(row)
        await self.protect_scene_review_files(sequence, row.content, 'scene-delivery:' + row.id)
        await self.db.flush()
        current = await self.db.get(SceneDeliveryUse, sequence_id)
        if current is None:
            self.db.add(SceneDeliveryUse(sequence_id=sequence_id, delivery_id=row.id))
        else:
            current.delivery_id = row.id
        await self.db.flush()
        return await self._delivery_read(row)

    async def chapter_deliveries(self, chapter_id):
        """章节顺序取当前划分，内容只取显式交付；缺失交付不猜测替代版本。"""
        chapter = await WorkspaceService(self.db, self.project_id).list_sequences(chapter_id)
        sequences = []
        for sequence in chapter.sequences:
            current = await self.db.get(SceneDeliveryUse, sequence.id)
            row = await self.db.get(SceneDeliveryRecord, current.delivery_id) if current else None
            sequences.append(ChapterSceneDelivery(sequence_id=sequence.id, title=sequence.title, position=sequence.position,
                delivery=await self._delivery_read(row) if row else None))
        return ChapterDeliveriesRead(chapter_id=chapter_id, title=chapter.title, sequences=sequences)
