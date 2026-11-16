"""前置对象提取交付与场次参考选择，不读取或更新旧场次版本。"""

from hashlib import sha256

from fastapi import HTTPException
from sqlalchemy import select

from app.core.contracts.directing.scene_objects import (
    ObjectExtractionRequest, SceneObjectCandidate, SceneObjectCandidateApplication, SceneObjectCandidateReceipt,
    SceneObjectCandidateReview, SceneObjectChoice, SceneObjectExtraction,
    SceneObjectExtractionResult, SceneObjectRead, SceneObjectsRead, SceneObjectTaskRead,
)
from app.core.contracts.directing.workspace import SourceSpan
from app.core.contracts.task import TERMINAL_TASK_STATUSES, TaskStatus
from app.models.directing import Sequence
from app.models.llm import ModelCategoryKey, Provider
from app.models.studio import FileUsage
from app.models.task import Task
from app.services.directing.scene_canvas import SCENE_TASK_ORDER, SceneCanvasService
from app.services.directing.store import RevisionConflict
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService


OBJECT_EXTRACTION_KIND = 'directing_object_extract'


def _source_digest(text: str, version: str, start: int | None) -> str:
    """同章修订的不同选取范围也必须区分。"""
    return sha256(f'{version}:{start}:{text}'.encode()).hexdigest()


def object_candidates(result: SceneObjectExtraction, args: dict) -> list[SceneObjectCandidate]:
    """用冻结文本核对唯一摘录与资产建议，生成与名称无关的稳定身份。"""
    text = args['script_text']
    valid_assets = {(item['kind'], item['id']) for item in args['existing_assets']}
    objects, ids = [], set()
    for row in result.objects:
        start = text.find(row.excerpt)
        end = start + len(row.excerpt)
        if start < 0 or text.find(row.excerpt, start + 1) >= 0:
            raise ValueError('对象出处必须是本场原文中可唯一定位的完整摘录')
        if row.asset_id and (row.kind, row.asset_id) not in valid_assets:
            raise ValueError('对象建议关联了不存在或类型不符的项目资产')
        identity = sha256(f"{args['sequence_id']}:{args['source_digest']}:{row.kind}:{start}:{end}".encode()).hexdigest()
        if identity in ids:
            raise ValueError('同类型对象必须使用可独立定位的原文出处')
        ids.add(identity)
        objects.append(SceneObjectCandidate(id=identity, kind=row.kind, name=row.name, description=row.description,
            excerpt=row.excerpt, span=SourceSpan(start=start, end=end), suggested_asset_id=row.asset_id))
    return objects


class SceneObjectService(SceneCanvasService):
    """真实场次及项目为读写边界，任务和人工准备有各自的持久化职责。"""

    def _tasks(self, sequence_id: str):
        return select(Task).where(Task.project_id == self.project_id, Task.target_type == 'directing_sequence',
                                   Task.target_id == sequence_id, Task.kind == OBJECT_EXTRACTION_KIND)

    @staticmethod
    def task_read(task: Task) -> SceneObjectTaskRead:
        """将统一任务状态投影为场次对象状态。"""
        return SceneObjectTaskRead(task_id=task.id, status=TaskStatus(task.status), stage=task.stage, error=task.error_message)

    async def read_objects(self, chapter_id: str, sequence_id: str) -> SceneObjectsRead:
        """保留上次成功准备，单独展示最新任务及当前文件有效性。"""
        sequence, _ = await self._scene(chapter_id, sequence_id)
        task = (await self.db.execute(self._tasks(sequence_id)
            .with_only_columns(Task.id, Task.status, Task.stage, Task.error_message)
            .order_by(SCENE_TASK_ORDER.desc(), Task.created_at.desc(), Task.id.desc()).limit(1))).one_or_none()
        if task and task.status == TaskStatus.succeeded:
            # 任务可能在两次查询之间提交，成功状态要随最新准备结果返回。
            await self.db.refresh(sequence, ['object_preparation'])
        prepared = sequence.object_preparation or {}
        assets = await self.assets(main_only=True)
        by_identity = {(asset.kind, asset.id): asset for asset in assets}
        candidates = [SceneObjectCandidate.model_validate(value) for value in prepared.get('objects', [])]
        objects = []
        for candidate in candidates:
            asset = by_identity.get((candidate.kind, candidate.asset_id))
            main = asset.main_image_file_id if asset else None
            state = 'ready' if main else 'unassociated' if not candidate.asset_id else 'missing' if asset else 'unavailable'
            objects.append(SceneObjectRead(**candidate.model_dump(), image_file_id=main, reference_state=state))
        digest = _source_digest(sequence.source_text, sequence.source['version'], sequence.source_start)
        latest_result = (await self.db.execute(self._tasks(sequence_id).with_only_columns(Task.id, Task.result).where(
            Task.input_snapshot['chapter_id'].as_string() == chapter_id,
            Task.status == TaskStatus.succeeded,
        ).order_by(SCENE_TASK_ORDER.desc(), Task.created_at.desc(), Task.id.desc()).limit(1))).one_or_none()
        candidate_task_id = latest_result.id if latest_result and (latest_result.result or {}).get('pending_application') else None
        return SceneObjectsRead(revision=prepared.get('revision', 0), source_version=prepared.get('source_version'),
            source_changed=bool(prepared and prepared['source_digest'] != digest), objects=objects, assets=assets,
            task=self.task_read(task) if task else None, candidate_task_id=candidate_task_id)

    async def submit_extraction(self, chapter_id: str, sequence_id: str, body: ObjectExtractionRequest) -> SceneObjectTaskRead:
        """冻结已确认场次摘录和有限资产目录，禁止同场重复排队。"""
        sequence, chapter = await self._scene(chapter_id, sequence_id, lock=True)
        request = body.model_dump(mode='json')
        tasks = self._tasks(sequence_id)
        existing = await self.db.scalar(tasks.where(Task.input_snapshot['object_extraction']['request_id'].as_string() == body.request_id))
        if existing:
            if existing.input_snapshot['object_extraction'] != request:
                raise RevisionConflict('对象提取请求身份已用于另一份内容')
            return self.task_read(existing)
        source = self.sequence_read(sequence, chapter).source
        if not sequence.is_current or not sequence.source_text.strip() or source.kind != 'chapter' or source.reference != chapter.id:
            raise ValueError('此场次没有可用的已确认原文')
        if await self.db.scalar(tasks.where(Task.status.not_in(TERMINAL_TASK_STATUSES)).limit(1)):
            raise RevisionConflict('本场已有对象提取任务，请等待或重试核实')
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        assets = sorted(await self.assets(), key=lambda asset: (asset.kind, asset.name, asset.id))
        args = {'sequence_id': sequence_id, 'script_text': sequence.source_text, 'source_version': source.version,
                'source_digest': _source_digest(sequence.source_text, source.version, sequence.source_start),
                'preparation_revision': (sequence.object_preparation or {}).get('revision', 0),
                'existing_assets': [{'id': asset.id, 'kind': asset.kind, 'name': asset.name, 'description': asset.description[:800]}
                                    for asset in assets[:120]]}
        task = await TaskService(self.db).submit(kind=OBJECT_EXTRACTION_KIND, title='提取场次对象',
            snapshot={'scene_admission_order': await self._next_scene_task_order(sequence_id), 'object_extraction': request, 'chapter_id': chapter.id, 'model_id': model.id, 'model_name': model.name,
                      'provider_key': config.provider_key, 'run_args': args}, project_id=self.project_id, provider_id=provider.id,
            target_type='directing_sequence', target_id=sequence_id)
        return self.task_read(task)

    async def save_choice(self, chapter_id: str, sequence_id: str, object_id: str, body: SceneObjectChoice) -> SceneObjectsRead:
        """按候选、资产类型与项目归属校验，只保存本场资源选用。"""
        sequence, _ = await self._scene(chapter_id, sequence_id, lock=True)
        if not sequence.is_current:
            raise ValueError('此场次已退出当前划分')
        preparation = sequence.object_preparation or {}
        if preparation.get('revision') != body.expected_revision:
            raise RevisionConflict('场次对象准备已更新，请重新核对')
        candidates = [SceneObjectCandidate.model_validate(item) for item in preparation['objects']]
        candidate = next((item for item in candidates if item.id == object_id), None)
        if candidate is None:
            raise HTTPException(404, 'Object not found in scene')
        from app.models.studio import Project
        await self.db.scalar(select(Project).where(Project.id == self.project_id).with_for_update())
        asset = next((item for item in await self.assets(main_only=True) if item.kind == candidate.kind and item.id == body.asset_id), None)
        if body.asset_id and not asset:
            raise ValueError('所选资产不属于当前项目或类型不符')
        candidate.asset_id = body.asset_id
        sequence.object_preparation = {**preparation, 'revision': body.expected_revision + 1,
                                       'objects': [item.model_dump(mode='json') for item in candidates]}
        await self.db.flush()
        return await self.read_objects(chapter_id, sequence_id)

    async def _extraction_task(self, chapter_id: str, sequence_id: str, task_id: str) -> Task:
        """候选读取及应用均先核实任务的真实章节和场次归属。"""
        task = await self.db.scalar(self._tasks(sequence_id).where(Task.id == task_id,
            Task.input_snapshot['chapter_id'].as_string() == chapter_id))
        if not task:
            raise HTTPException(404, '未找到此场次的对象提取任务')
        return task

    @staticmethod
    def _extraction_result(task: Task) -> SceneObjectExtractionResult | None:
        if task.status != TaskStatus.succeeded or 'pending_application' not in (task.result or {}):
            return None
        return SceneObjectExtractionResult.model_validate(task.result)

    def _candidate_plan(self, sequence: Sequence, task: Task, result: SceneObjectExtractionResult
                        ) -> tuple[SceneObjectCandidateReview, list[SceneObjectCandidate]]:
        """按冻结出处产生的身份匹配，保留当前人工选择，并绑定当前准备修订。"""
        prepared = sequence.object_preparation or {}
        revision = prepared.get('revision', 0)
        digest = _source_digest(sequence.source_text, sequence.source['version'], sequence.source_start)
        source_changed = digest != task.input_snapshot['run_args']['source_digest']
        previous = {row['id']: SceneObjectCandidate.model_validate(row) for row in prepared.get('objects', [])}
        new_ids = {row.id for row in result.objects}
        added, modified, retained_choices, merged = [], [], [], []
        removed = [row for row in previous.values() if row.id not in new_ids]
        for row in result.objects:
            prior = previous.get(row.id)
            if prior:
                row = row.model_copy(update={'asset_id': prior.asset_id})
                if row != prior:
                    modified.append(row)
                if prior.asset_id:
                    retained_choices.append(row)
            else:
                added.append(row)
            merged.append(row)
        token = None
        if sequence.is_current and not source_changed and result.pending_application:
            token = sha256(f'{task.id}:{revision}:{digest}'.encode()).hexdigest()
        review = SceneObjectCandidateReview(task=self.task_read(task), candidate_available=True, revision=revision, source_changed=source_changed,
            is_current=sequence.is_current, applied_revision=result.applied_revision, preview_token=token,
            added=added, removed=removed, modified=modified, retained_choices=retained_choices)
        return review, merged

    async def read_candidate(self, chapter_id: str, sequence_id: str, task_id: str) -> SceneObjectCandidateReview:
        """按身份读取任务状态，可用时提供整批差异。"""
        sequence, _ = await self._scene(chapter_id, sequence_id)
        task = await self._extraction_task(chapter_id, sequence_id, task_id)
        result = self._extraction_result(task)
        if result is None or not result.pending_application and result.applied_revision is None:
            return SceneObjectCandidateReview(task=self.task_read(task), candidate_available=False,
                revision=(sequence.object_preparation or {}).get('revision', 0), source_changed=False,
                is_current=sequence.is_current, added=[], removed=[], modified=[], retained_choices=[])
        review, _ = self._candidate_plan(sequence, task, result)
        return review

    async def discard_candidate(self, chapter_id: str, sequence_id: str, task_id: str) -> SceneObjectTaskRead:
        """只退出尚未应用的候选，幂等保留任务结果和当前场次准备。"""
        await self._scene(chapter_id, sequence_id, lock=True)
        task = await self._extraction_task(chapter_id, sequence_id, task_id)
        result = self._extraction_result(task)
        if result is None:
            raise HTTPException(409, '此对象提取尚无可退出的候选')
        if result.applied_revision is not None:
            raise RevisionConflict('该对象提取结果已应用，不能退出')
        result.pending_application = False
        task.result = result.model_dump(mode='json')
        await self.db.flush()
        return self.task_read(task)

    async def apply_candidate(self, chapter_id: str, sequence_id: str, task_id: str,
                              body: SceneObjectCandidateApplication) -> SceneObjectCandidateReceipt:
        """在场次写锁内核对预览，并同时保存整批准备和该任务的原回执。"""
        sequence, _ = await self._scene(chapter_id, sequence_id, lock=True)
        task = await self._extraction_task(chapter_id, sequence_id, task_id)
        result = self._extraction_result(task)
        if result is None:
            raise HTTPException(404, '未找到此场次可核对的对象提取结果')
        if not result.pending_application:
            if result.application == body and result.applied_revision is not None:
                return SceneObjectCandidateReceipt(task_id=task.id, revision=result.applied_revision)
            raise RevisionConflict('该对象提取结果已应用或已退出')
        review, merged = self._candidate_plan(sequence, task, result)
        if not review.is_current:
            raise RevisionConflict('此场次已退出当前划分，不能应用对象候选')
        if review.source_changed:
            raise RevisionConflict('已确认场次原文已变化，请重新提取对象')
        if review.revision != body.expected_revision or review.preview_token != body.preview_token:
            raise RevisionConflict('场次对象准备已更新，请重新核对差异')
        revision = review.revision + 1
        await self._save_preparation(sequence, task.input_snapshot['run_args'], merged, revision)
        result.pending_application = False
        result.applied_revision = revision
        result.application = body
        task.result = result.model_dump(mode='json')
        await self.db.flush()
        return SceneObjectCandidateReceipt(task_id=task.id, revision=revision)

    async def _save_preparation(self, sequence: Sequence, args: dict, objects: list[SceneObjectCandidate], revision: int) -> None:
        """沿用准备存储，使既有分镜输入只读取已采用对象。"""
        from sqlalchemy import delete
        previous = {item['id'] for item in (sequence.object_preparation or {}).get('objects', [])}
        removed = previous - {item.id for item in objects}
        if removed:
            await self.db.execute(delete(FileUsage).where(FileUsage.project_id == self.project_id,
                FileUsage.usage_kind == 'directing_reference',
                FileUsage.source_ref.in_([f'scene-object:{sequence.id}:{id_}' for id_ in removed])))
        sequence.object_preparation = {'revision': revision, 'source_version': args['source_version'],
            'source_digest': args['source_digest'], 'objects': [item.model_dump(mode='json') for item in objects]}

    async def complete_extraction(self, task: Task, result: SceneObjectExtraction) -> SceneObjectExtractionResult:
        """首次适用结果直接交付，其他成功结果保留为待核对候选。"""
        args = task.input_snapshot['run_args']
        await self._lock_sqlite_scene(task.input_snapshot['chapter_id'], task.target_id)
        sequence = await self.db.scalar(select(Sequence).where(Sequence.id == task.target_id,
            Sequence.chapter_id == task.input_snapshot['chapter_id']).with_for_update().execution_options(populate_existing=True))
        if sequence is None:
            raise RevisionConflict('此场次已不可用')
        objects = object_candidates(result, args)
        digest = _source_digest(sequence.source_text, sequence.source['version'], sequence.source_start)
        revision = (sequence.object_preparation or {}).get('revision', 0)
        if sequence.is_current and digest == args['source_digest'] and revision == args['preparation_revision'] == 0:
            await self._save_preparation(sequence, args, objects, 1)
            return SceneObjectExtractionResult(objects=objects, pending_application=False, applied_revision=1)
        return SceneObjectExtractionResult(objects=objects, pending_application=True)
