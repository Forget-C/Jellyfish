"""Maintain shooting explanations and run checks on a full chapter source."""
from hashlib import sha256

from sqlalchemy import select, update

from app.core.contracts.directing.shooting_preparation import (
    ShootingCheckRead, ShootingCheckRequest, ShootingExplanationRead, ShootingExplanationSave, ShootingPreparation,
)
from app.models.directing import ChapterShootingExplanation
from app.models.llm import ModelCategoryKey, Provider
from app.models.studio import Chapter
from app.models.task import Task
from app.services.chapters.explanations import explanation_basis
from app.services.directing.division import DivisionService, digest
from app.services.directing.shooting_explanations import inherited_preparation, source_text
from app.services.directing.store import RevisionConflict
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService


class ShootingPreparationService(DivisionService):
    """Use the chapter lock to serialize explanation writes with division and generation."""

    async def _lock_chapter(self, chapter_id):
        if self.db.get_bind().dialect.name == 'sqlite':
            await self.db.execute(update(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == self.project_id)
                .values(updated_at=Chapter.updated_at).execution_options(synchronize_session=False))
        return await super()._lock_chapter(chapter_id)

    async def _record(self, chapter_id, source_version, *, locked=False):
        return await self.db.get(ChapterShootingExplanation, (chapter_id, source_version),
                                 with_for_update=locked, populate_existing=True)

    @staticmethod
    def _read(record):
        return ShootingExplanationRead(source_version=record.source_version, version=record.version,
                                       preparation=record.preparation)

    async def read_preparation(self, chapter_id, source_version):
        """Read the saved set, or preview inheritance before adopting a new source."""
        chapter = await self.chapter(chapter_id)
        text = await source_text(self.db, chapter, source_version)
        record = await self._record(chapter_id, source_version)
        if record is not None:
            return self._read(record)
        preparation = (await inherited_preparation(self.db, chapter_id, source_version, text)
                       if sha256(chapter.raw_text.encode()).hexdigest() == source_version else ShootingPreparation())
        return ShootingExplanationRead(source_version=source_version, version=0, preparation=preparation)

    @staticmethod
    def _validate_notes(text, preparation):
        for note in preparation.notes:
            if note.scope and (note.scope.start >= note.scope.end or note.scope.end > len(text)
                               or not text[note.scope.start:note.scope.end].strip()):
                raise ValueError('拍摄解释的适用范围必须对应有效原文')
            if note.choice in ('adopt', 'delegate') and (
                    note.previous_scope_text or (note.excerpt and note.excerpt not in text)):
                raise ValueError('请先核对拍摄解释的适用范围和引用依据')

    @staticmethod
    def _validate_new_scopes(preparation, baseline):
        """Keep historical overlaps while rejecting new intersecting ranges."""
        old_scopes = {(note.scope.start, note.scope.end) for note in baseline.notes if note.scope}
        located = sorted((note for note in preparation.notes if note.scope), key=lambda note: note.scope.start)
        for index, left in enumerate(located):
            for right in located[index + 1:]:
                if right.scope.start >= left.scope.end:
                    break
                if left.scope == right.scope:
                    continue
                if (left.scope.start, left.scope.end) in old_scopes and (right.scope.start, right.scope.end) in old_scopes:
                    continue
                raise ValueError('拍摄解释选段相交，请使用已有选段或重新选择')

    async def save_preparation(self, chapter_id: str, body: ShootingExplanationSave) -> ShootingExplanationRead:
        """Save one source version using optimistic concurrency and safe immediate retry."""
        chapter = await self._lock_chapter(chapter_id)
        text = await source_text(self.db, chapter, body.source_version)
        record = await self._record(chapter_id, body.source_version, locked=True)
        request_hash = digest(body.model_dump(mode='json'))
        if record and record.last_request_id == body.request_id:
            if record.last_request_hash != request_hash:
                raise RevisionConflict('保存身份已用于另一份拍摄解释')
            return self._read(record)
        version = record.version if record else 0
        if version != body.expected_version:
            raise RevisionConflict('拍摄解释已修改，请保留输入并核对最新内容')
        value = body.preparation.model_copy(deep=True)
        self._validate_notes(text, value)
        baseline = ShootingPreparation()
        if record:
            baseline = ShootingPreparation.model_validate(record.preparation)
        elif sha256(chapter.raw_text.encode()).hexdigest() == body.source_version:
            baseline = await inherited_preparation(self.db, chapter_id, body.source_version, text, locked=True)
        self._validate_new_scopes(value, baseline)
        value.check_covered = None
        if value.check_task_id:
            report = await self.read_check(chapter_id, value.check_task_id)
            task = await self.db.get(Task, value.check_task_id)
            if (task.input_snapshot['request'].get('source_version') != body.source_version
                    or task.input_snapshot['request'].get('draft_key')):
                raise ValueError('报告不属于该版整章原文')
            value.check_covered = report.status == 'succeeded' and report.basis_current and report.preparation.notes == value.notes
        payload = value.model_dump(mode='json')
        if record is None:
            record = ChapterShootingExplanation(chapter_id=chapter_id, source_version=body.source_version,
                                               raw_text=text, version=1, preparation=payload)
            self.db.add(record)
        elif record.preparation != payload:
            record.version += 1
            record.preparation = payload
        record.last_request_id = body.request_id
        record.last_request_hash = request_hash
        await self.db.flush()
        return self._read(record)

    def _checks(self, chapter_id):
        return select(Task).where(Task.project_id == self.project_id, Task.target_id == chapter_id,
            Task.target_type == 'directing_chapter', Task.kind == 'directing_shooting_check')

    @staticmethod
    def _explanations(chapter, version):
        return explanation_basis(chapter)['items'] if sha256(chapter.raw_text.encode()).hexdigest() == version else []

    async def submit_check(self, chapter_id, body: ShootingCheckRequest):
        """Freeze the server-owned full text and draft explanations for one source version."""
        chapter = await self._lock_chapter(chapter_id)
        text = await source_text(self.db, chapter, body.source_version)
        if not text.strip():
            raise ValueError('请先填写章节原文')
        self._validate_notes(text, body.preparation)
        existing = await self.db.scalar(self._checks(chapter_id).where(
            Task.input_snapshot['request']['request_id'].as_string() == body.request_id))
        if existing:
            if existing.input_snapshot['request'] != body.model_dump(mode='json'):
                raise RevisionConflict('检查身份已用于另一份内容')
            return await self.read_check(chapter_id, existing.id)
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        task = await TaskService(self.db).submit(kind='directing_shooting_check', title='整章拍摄检查',
            target_type='directing_chapter', target_id=chapter_id, project_id=self.project_id, provider_id=provider.id,
            snapshot={'request': body.model_dump(mode='json'), 'model_id': model.id, 'model_name': model.name,
                'provider_key': config.provider_key, 'run_args': {'script_text': text, 'source_start': 0,
                    'shooting_preparation': body.preparation.model_dump(mode='json'),
                    'source_explanations': self._explanations(chapter, body.source_version)}})
        return await self.read_check(chapter_id, task.id)

    async def read_check(self, chapter_id, task_id):
        """Read frozen inputs and the original report without editing either."""
        chapter = await self.chapter(chapter_id)
        task = await self.db.scalar(self._checks(chapter_id).where(Task.id == task_id))
        if task is None:
            raise ValueError('检查不属于当前章节')
        args = task.input_snapshot['run_args']
        version = task.input_snapshot['request'].get('source_version')
        return ShootingCheckRead(task_id=task.id, status=task.status, error=task.error_message,
            source_text=args['script_text'], preparation=args['shooting_preparation'],
            report=task.result if task.status == 'succeeded' else None,
            basis_current=args.get('source_explanations', []) == self._explanations(chapter, version))

    async def latest_check(self, chapter_id, source_version):
        """Recover the latest whole-chapter check for the selected source version."""
        await self.chapter(chapter_id)
        task = await self.db.scalar(self._checks(chapter_id).where(
            Task.input_snapshot['request']['source_version'].as_string() == source_version,
            Task.input_snapshot['request']['draft_key'].as_string().is_(None))
            .order_by(Task.created_at.desc(), Task.id.desc()).limit(1))
        return await self.read_check(chapter_id, task.id) if task else None
