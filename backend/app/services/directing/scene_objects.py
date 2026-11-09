"""前置对象提取交付与场次参考选择，不读取或更新旧场次版本。"""

from hashlib import sha256

from fastapi import HTTPException
from sqlalchemy import select

from app.core.contracts.directing.scene_objects import (
    ObjectExtractionRequest, SceneObjectCandidate, SceneObjectChoice, SceneObjectExtraction,
    SceneObjectRead, SceneObjectsRead, SceneObjectTaskRead,
)
from app.core.contracts.directing.workspace import SourceSpan
from app.core.contracts.task import TERMINAL_TASK_STATUSES, TaskStatus
from app.models.directing import Sequence
from app.models.llm import ModelCategoryKey, Provider
from app.models.studio import FileItem, FileUsage
from app.models.task import Task
from app.services.directing.scene_canvas import SceneCanvasService
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

    async def _uploads(self, chapter_id: str, sequence_id: str, objects: list[SceneObjectCandidate]) -> set[tuple[str, str]]:
        references = {f'scene-object:{sequence_id}:{item.id}': item.id for item in objects}
        if not references:
            return set()
        rows = await self.db.execute(select(FileUsage.source_ref, FileItem.id)
            .join(FileItem, FileItem.id == FileUsage.file_id).where(
                FileUsage.project_id == self.project_id, FileUsage.chapter_id == chapter_id,
                FileUsage.usage_kind == 'generation_upload', FileUsage.source_ref.in_(references),
                FileItem.type == 'image', FileItem.deleted_at.is_(None), FileItem.delete_requested_at.is_(None)))
        return {(references[source_ref], file_id) for source_ref, file_id in rows}

    async def read_objects(self, chapter_id: str, sequence_id: str) -> SceneObjectsRead:
        """保留上次成功准备，单独展示最新任务及当前文件有效性。"""
        sequence, _ = await self._scene(chapter_id, sequence_id)
        task = await self.db.scalar(self._tasks(sequence_id).order_by(Task.created_at.desc(), Task.id.desc()).limit(1))
        prepared = sequence.object_preparation or {}
        assets = await self.assets()
        by_identity = {(asset.kind, asset.id): asset for asset in assets}
        candidates = [SceneObjectCandidate.model_validate(value) for value in prepared.get('objects', [])]
        uploads = await self._uploads(chapter_id, sequence_id, candidates)
        objects = []
        for candidate in candidates:
            asset = by_identity.get((candidate.kind, candidate.asset_id))
            if candidate.image_file_id:
                ready = (candidate.id, candidate.image_file_id) in uploads or bool(
                    asset and candidate.image_file_id in asset.image_file_ids)
                state = 'ready' if ready else 'unavailable'
            else:
                state = 'unassociated' if not candidate.asset_id else 'missing' if asset else 'unavailable'
            objects.append(SceneObjectRead(**candidate.model_dump(), reference_state=state))
        digest = _source_digest(sequence.source_text, sequence.source['version'], sequence.source_start)
        return SceneObjectsRead(revision=prepared.get('revision', 0), source_version=prepared.get('source_version'),
            source_changed=bool(prepared and prepared['source_digest'] != digest), objects=objects, assets=assets,
            task=self.task_read(task) if task else None)

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
            snapshot={'object_extraction': request, 'chapter_id': chapter.id, 'model_id': model.id, 'model_name': model.name,
                      'provider_key': config.provider_key, 'run_args': args}, project_id=self.project_id, provider_id=provider.id,
            target_type='directing_sequence', target_id=sequence_id)
        return self.task_read(task)

    async def save_choice(self, chapter_id: str, sequence_id: str, object_id: str, body: SceneObjectChoice) -> SceneObjectsRead:
        """按候选、资产类型、项目与真实图片归属校验，再保存本场选择。"""
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
        asset = next((item for item in await self.assets() if item.kind == candidate.kind and item.id == body.asset_id), None)
        if body.asset_id and not asset:
            raise ValueError('所选资产不属于当前项目或类型不符')
        if body.image_file_id and not (asset and body.image_file_id in asset.image_file_ids):
            uploads = await self._uploads(chapter_id, sequence_id, [candidate])
            if (candidate.id, body.image_file_id) not in uploads:
                raise ValueError('所选图片不属于该资产或本场对象的可用上传')
        candidate.asset_id = body.asset_id
        candidate.image_file_id = body.image_file_id
        sequence.object_preparation = {**preparation, 'revision': body.expected_revision + 1,
                                       'objects': [item.model_dump(mode='json') for item in candidates]}
        await self.db.flush()
        return await self.read_objects(chapter_id, sequence_id)

    async def complete_extraction(self, task: Task, result: SceneObjectExtraction) -> None:
        """仅在成功事务交付，按精确身份保留并发人工选择。"""
        args = task.input_snapshot['run_args']
        sequence = await self.db.scalar(select(Sequence).where(Sequence.id == task.target_id,
            Sequence.chapter_id == task.input_snapshot['chapter_id']).with_for_update().execution_options(populate_existing=True))
        if sequence is None or not sequence.is_current:
            raise RevisionConflict('此场次已退出当前划分')
        if _source_digest(sequence.source_text, sequence.source['version'], sequence.source_start) != args['source_digest']:
            raise RevisionConflict('场次原文已改变，请重新提取对象')
        previous = sequence.object_preparation or {}
        if previous.get('revision', 0) != args['preparation_revision']:
            raise RevisionConflict('提取期间对象参考已修改，已保留人工选择，请重新提取')
        by_id = {item['id']: item for item in previous.get('objects', [])}
        objects = object_candidates(result, args)
        for candidate in objects:
            if old := by_id.get(candidate.id):
                candidate.asset_id = old['asset_id']
                candidate.image_file_id = old['image_file_id']
        sequence.object_preparation = {'revision': previous.get('revision', 0) + 1,
            'source_version': args['source_version'], 'source_digest': args['source_digest'],
            'objects': [item.model_dump(mode='json') for item in objects]}
