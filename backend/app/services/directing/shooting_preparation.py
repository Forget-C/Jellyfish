"""场次拍摄准备即时保存与不可变划分版本共享事务。"""
from hashlib import sha256
from types import SimpleNamespace
from sqlalchemy import select
from app.core.contracts.directing.shooting_preparation import ShootingPreparation, ShootingPreparationSave
from app.core.contracts.directing.workspace import ChapterSequences
from app.models.directing import DivisionCommit, DivisionVersion, Sequence
from app.services.directing.division import DivisionService, digest
from app.services.directing.division_versions import current_version, record_version
from app.services.directing.store import RevisionConflict


class ShootingPreparationService(DivisionService):
    """只写指定场次说明，不提交其他场次的客户端草稿。"""

    async def save_preparation(self, chapter_id: str, sequence_id: str,
                               body: ShootingPreparationSave) -> ChapterSequences:
        """锁定章节、比较场次修订，说明与新历史快照原子提交。"""
        chapter = await self._lock_chapter(chapter_id)
        request_hash = digest({'scene': sequence_id, 'preparation': body.model_dump(mode='json')})
        receipt_id = 'p:' + sha256(body.request_id.encode()).hexdigest()[:60]
        receipt = await self.db.get(DivisionCommit, (chapter_id, receipt_id), populate_existing=True, with_for_update=True)
        if receipt:
            if receipt.request_hash != request_hash:
                raise RevisionConflict('保存身份已用于另一份拍摄说明')
            return ChapterSequences.model_validate(receipt.response)
        rows = list(await self.db.scalars(select(Sequence).where(Sequence.chapter_id == chapter_id,
            Sequence.is_current.is_(True)).order_by(Sequence.position).with_for_update().execution_options(populate_existing=True)))
        row = next((item for item in rows if item.id == sequence_id), None)
        if row is None:
            raise ValueError('场次不属于本章当前划分')
        if row.version != body.expected_version:
            raise RevisionConflict('场次已修改，请保留输入并重新核对')
        head = await current_version(self.db, chapter_id, locked=True)
        basis = await self.db.get(DivisionVersion, head.id) if head else None
        if basis:
            chapter = SimpleNamespace(id=chapter.id, title=chapter.title, raw_text=basis.snapshot['raw_text'])
        await self._validate_preparation(chapter_id, body.preparation)
        payload = (await self._stored_preparation(chapter_id, row.source_text, body.preparation, row.source_start, row.source['version'])).model_dump(mode='json')
        async with self.db.begin_nested():
            if ShootingPreparation.model_validate(row.shooting_preparation or {}).model_dump(mode='json') != payload:
                if not await current_version(self.db, chapter_id, locked=True):
                    await record_version(self.db, self.division_snapshot(chapter, rows), origin='baseline')
                row.shooting_preparation = payload
                row.version += 1
                await self.db.flush()
                result = await record_version(self.db, self.division_snapshot(chapter, rows), origin='manual')
            else:
                result = self.division_snapshot(chapter, rows)
                result.current_version = await current_version(self.db, chapter_id)
            self.db.add(DivisionCommit(chapter_id=chapter_id, request_id=receipt_id,
                request_hash=request_hash, response=result.model_dump(mode='json')))
            await self.db.flush()
        return result

    async def submit_check(self, chapter_id, body):
        """独立检查草稿，不要求创建场次，也不更改说明。"""
        from app.models.task import Task
        from app.models.llm import ModelCategoryKey, Provider
        from app.services.llm.resolver import get_model_by_category
        from app.services.llm.provider_resolver import resolve_provider_config_from_provider
        from app.services.task_service import TaskService
        chapter = await self._lock_chapter(chapter_id)
        existing = await self.db.scalar(select(Task).where(Task.project_id == self.project_id,
            Task.target_id == chapter_id, Task.kind == 'directing_shooting_check',
            Task.input_snapshot['request']['request_id'].as_string() == body.request_id))
        if existing:
            if existing.input_snapshot['request'] != body.model_dump(mode='json'):
                raise RevisionConflict('检查身份已用于另一份内容')
            return await self.read_check(chapter_id, existing.id)
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        task = await TaskService(self.db).submit(kind='directing_shooting_check', title='场次拍摄检查',
            target_type='directing_chapter', target_id=chapter_id, project_id=self.project_id, provider_id=provider.id,
            snapshot={'request': body.model_dump(mode='json'), 'model_id': model.id, 'model_name': model.name,
                'provider_key': config.provider_key, 'run_args': {'script_text': body.source_text,
                    'shooting_preparation': body.preparation.model_dump(mode='json'),
                    **self._check_explanations(chapter, body)}})
        return await self.read_check(chapter_id, task.id)

    async def read_check(self, chapter_id, task_id):
        """按项目与章节读取冻结依据，历史报告不套用当前内容。"""
        from app.models.task import Task
        from app.core.contracts.directing.shooting_preparation import ShootingCheckRead, ShootingCheckRequest
        chapter = await self.chapter(chapter_id)
        task = await self.db.scalar(select(Task).where(Task.id == task_id, Task.project_id == self.project_id,
            Task.target_type == 'directing_chapter', Task.target_id == chapter_id, Task.kind == 'directing_shooting_check'))
        if task is None:
            raise ValueError('检查不属于当前章节')
        args = task.input_snapshot['run_args']
        return ShootingCheckRead(task_id=task.id, status=task.status, error=task.error_message,
            source_text=args['script_text'], preparation=args['shooting_preparation'],
            report=task.result if task.status == 'succeeded' else None,
            basis_current=args.get('source_explanations', []) == self._check_explanations(
                chapter, ShootingCheckRequest.model_validate(task.input_snapshot['request'])).get('source_explanations', []))

    async def latest_check(self, chapter_id, draft_key):
        """重开弹窗可找回已受理任务，不以关闭弹窗取消后台检查。"""
        from app.models.task import Task
        await self.chapter(chapter_id)
        task_id = await self.db.scalar(select(Task.id).where(Task.project_id == self.project_id,
            Task.target_type == 'directing_chapter', Task.target_id == chapter_id, Task.kind == 'directing_shooting_check',
            Task.input_snapshot['request']['draft_key'].as_string() == draft_key)
            .order_by(Task.created_at.desc(), Task.id.desc()).limit(1))
        return await self.read_check(chapter_id, task_id) if task_id else None
