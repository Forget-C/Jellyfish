"""当前方案可浏览同场次素材，生产来源不随复用改变。"""
from datetime import UTC

from sqlalchemy import or_, select

from app.core.contracts.directing.scene_take_review import SceneTakeReviewRead
from app.core.contracts.directing.scene_version import SceneVersionContent
from app.core.contracts.directing.scene_timeline import SceneTimeline
from app.core.contracts.directing.production import ProductionPlan, Prompt
from app.core.contracts.directing.scene_video import SceneVideoPreparation
from app.core.contracts.directing.scene_take_library import SceneTakeLibraryRead
from app.models.directing import Take, SceneTakeRecord, SceneVideoExecution, SceneVersionRecord, SceneTakeReviewRecord
from app.models.studio import Chapter, FileItem
from app.services.directing.store import DirectingStore, RevisionConflict


class SceneTakeService(DirectingStore):
    """汇集固定生产来源，独立保存人工复核记录，不改写共享 Take。"""

    async def _library_item(self, take, *, kind, origin_id, unit_id, **source):
        file = await self.db.get(FileItem, take.file_id)
        available = bool(file and file.type == 'video' and file.deleted_at is None and file.delete_requested_at is None)
        return SceneTakeLibraryRead(take_kind=kind, take_id=take.id, file_id=take.file_id,
            origin_id=origin_id, unit_id=unit_id, task_id=take.task_id, available=available,
            duration_ms=file.duration_ms if file else None,
            media_url=f'/api/v1/studio/files/{take.file_id}/download' if available else None, **source)

    async def list_scene_takes(self, sequence_id, version_id):
        """通过目标版本校验项目和场次归属，再只读取同场次原记录。"""
        await self.read_scene_version(sequence_id, version_id)
        rows = []
        legacy = await self.db.scalars(select(Take).where(Take.sequence_id == sequence_id).order_by(Take.created_at, Take.id))
        for take in legacy:
            prompt = await self.revision(take.prompt_revision_id, kind='prompt', sequence_id=sequence_id, confirmed=True)
            plan = await self.revision(take.plan_revision_id, kind='plan', sequence_id=sequence_id, confirmed=True)
            rows.append(await self._library_item(take, kind='production_plan', origin_id=take.plan_revision_id,
                unit_id=take.unit_id, prompt=Prompt.model_validate(prompt.payload), production_plan=ProductionPlan.model_validate(plan.payload)))
        current = await self.db.execute(select(SceneTakeRecord, SceneVideoExecution).join(
            SceneVideoExecution, SceneVideoExecution.id == SceneTakeRecord.execution_id).join(
            SceneVersionRecord, SceneVersionRecord.id == SceneVideoExecution.version_id).where(
            SceneVersionRecord.sequence_id == sequence_id).order_by(SceneTakeRecord.created_at, SceneTakeRecord.id))
        for take, execution in current:
            rows.append(await self._library_item(take, kind='scene_video', origin_id=execution.version_id,
                unit_id=execution.unit_id, video_preparation=SceneVideoPreparation.model_validate(execution.preparation)))
        return rows

    async def list_take_reviews(self, sequence_id, version_id):
        """读取固定审片依据，与当前已保存方案比较；不回写历史结论。"""
        version = await self.read_scene_version(sequence_id, version_id)
        inherited = await self.inherited_scene_review_ids(version_id, 'take')
        rows = await self.db.scalars(select(SceneTakeReviewRecord).where(or_(
            SceneTakeReviewRecord.version_id == version_id, SceneTakeReviewRecord.id.in_(inherited))).order_by(SceneTakeReviewRecord.created_at, SceneTakeReviewRecord.id))
        result = []
        for row in rows:
            content = SceneVersionContent.model_validate(row.content)
            current = version.content.model_copy(update={'take_judgments': [item for item in version.content.take_judgments
                if (item.take_kind, item.take_id) == (row.take_kind, row.take_id)]})
            result.append(SceneTakeReviewRead(id=row.id, version_id=row.version_id, revision=row.revision,
                take_kind=row.take_kind, take_id=row.take_id, content=content, created_at=row.created_at.replace(tzinfo=UTC) if row.created_at.tzinfo is None else row.created_at,
                matches_current=content.model_copy(update={'timeline': SceneTimeline()}) == current.model_copy(update={'timeline': SceneTimeline()})))
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
