"""整份另存固定输入与来源，在创建事务内重新核实全部相关任务。"""
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.exc import OperationalError

from app.core.contracts.directing.scene_copy import SceneCopyBlocker, SceneCopyReadiness, SceneVersionCopy
from app.models.directing import SceneCopyOrigin, SceneCutReviewRecord, SceneSeamReviewRecord, SceneTakeReviewRecord, SceneVersionRecord, SceneVideoExecution
from app.models.task import Task
from app.models.studio import Chapter
from app.services.directing.scene_design import SceneDesignService
from app.services.directing.store import RevisionConflict


class SceneCopyService(SceneDesignService):
    """复制当前内容，不自动保存原版本、应用建议或创建任何生成任务。"""

    async def copy_readiness(self, sequence_id, version_id):
        """与所有本版本新提交共用章节锁，当前读任务状态防止事务快照漏掉新任务。"""
        await self._version(sequence_id, version_id)
        video_ids = select(SceneVideoExecution.task_id).where(SceneVideoExecution.version_id == version_id)
        query = select(Task).where(Task.project_id == self.project_id, or_(
            Task.input_snapshot['scene_export']['version_id'].as_string() == version_id,
            Task.input_snapshot['scene_design']['version_id'].as_string() == version_id,
            Task.input_snapshot['scene_instruction']['version_id'].as_string() == version_id,
            Task.input_snapshot['instruction_check']['version_id'].as_string() == version_id,
            Task.id.in_(video_ids)), Task.status.not_in(['succeeded', 'failed', 'cancelled'])).order_by(Task.id)
        try:
            tasks = list(await self.db.scalars(query.with_for_update(nowait=True)))
        except OperationalError as error:
            raise RevisionConflict('任务状态正在更新或读取失败，尚未创建副本；请重读后再试') from error
        blockers = [SceneCopyBlocker(task_id=task.id, execution_id=None, title=task.title or '关联任务', status=task.status) for task in tasks]
        missing = await self.db.scalars(select(SceneVideoExecution).outerjoin(Task, Task.id == SceneVideoExecution.task_id).where(
            SceneVideoExecution.version_id == version_id, Task.id.is_(None)))
        blockers.extend(SceneCopyBlocker(task_id=None, execution_id=row.id, title='视频提交结果尚未核实', status='unknown') for row in missing)
        return SceneCopyReadiness(ready=not blockers, blockers=blockers)

    async def copy_version(self, sequence_id, version_id, body):
        """既有请求先核实；新请求在同一章节锁内校验任务、内容并创建独立版本。"""
        sequence = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        current = await self.read_scene_version(sequence_id, version_id)
        existing = await self.db.scalar(select(SceneVersionRecord).where(
            SceneVersionRecord.sequence_id == sequence_id, SceneVersionRecord.create_request_id == body.request_id))
        if existing is not None:
            origin = await self.db.get(SceneCopyOrigin, existing.id)
            if origin is None or origin.source_version_id != version_id or SceneVersionCopy.model_validate(origin.request) != body:
                raise RevisionConflict('创建请求身份已用于另一份内容')
            return await self.read_scene_version(sequence_id, existing.id)
        await self.current_sequence(sequence_id)
        if current.revision != body.expected_revision:
            raise RevisionConflict('原保存结果已变化，请先核实在途保存，再按保留的编辑另存为')
        readiness = await self.copy_readiness(sequence_id, version_id)
        if not readiness.ready:
            raise RevisionConflict('关联任务尚未明确结束，不能另存为：' + '；'.join(f'{row.title}（{row.status}）' for row in readiness.blockers))
        await self._validate_content(sequence, version_id, body.content)
        for unit in body.content.units:
            if unit.instruction_basis_id:
                await self.instruction_basis(version_id, unit.id, unit.instruction_basis_id)
            if unit.instruction_check_task_id:
                await self.confirmable_instruction_check(sequence_id, version_id, unit.id, unit.instruction_check_task_id)
        original = await self.db.get(SceneVersionRecord, version_id)
        bases = await self._scene_source_bases(sequence, original, body.content.basis)
        row = SceneVersionRecord(id=uuid4().hex, sequence_id=sequence_id, title=body.title, revision=1,
            create_request_id=body.request_id, source_bases=[basis.model_dump(mode='json') for basis in bases],
            content=body.content.model_dump(mode='json'))
        self.db.add(row)
        await self.db.flush()
        reviews = {}
        for kind, model in [('cut', SceneCutReviewRecord), ('seam', SceneSeamReviewRecord), ('take', SceneTakeReviewRecord)]:
            inherited = await self.inherited_scene_review_ids(version_id, kind)
            reviews[kind] = list(await self.db.scalars(select(model.id).where(or_(
                model.version_id == version_id, model.id.in_(inherited)))))
        self.db.add(SceneCopyOrigin(version_id=row.id, source_version_id=version_id,
            request=body.model_dump(mode='json'), review_ids=reviews))
        await self.protect_scene_review_files(sequence, row.content, 'scene-version:' + row.id)
        await self.db.flush()
        return await self.read_scene_version(sequence_id, row.id)
