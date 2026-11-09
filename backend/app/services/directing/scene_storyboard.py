"""提交文本分镜任务并校验初次共同画布候选，不绕过画布保存。"""

from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import select

from app.core.contracts.directing.scene_canvas import SceneCanvasCreate
from app.core.contracts.directing.scene_storyboard import SceneStoryboard, StoryboardCandidate, StoryboardRequest, StoryboardTaskRead
from app.core.contracts.task import TaskStatus
from app.models.generation_canvas import CanvasSaveReceipt
from app.models.llm import Model, ModelCategoryKey, Provider
from app.models.studio import FileUsage
from app.models.task import Task
from app.schemas.generation_canvas import CanvasDocument
from app.services.directing.scene_objects import SceneObjectService
from app.services.directing.store import RevisionConflict
from app.services.directing.storyboard_assembly import STORYBOARD_KIND, StoryboardAssembly
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.document_save import prepare_document
from app.services.generation_canvas.store import CanvasStore
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.studio.file_usages import upsert_file_usage
from app.services.task_service import TaskService


class SceneStoryboardService(SceneObjectService):
    """场次范围内提交和读取，不依赖旧场次版本或媒体执行许可。"""

    def _storyboards(self, sequence_id: str):
        return select(Task).where(Task.kind == STORYBOARD_KIND, Task.project_id == self.project_id,
                                  Task.target_type == 'directing_sequence', Task.target_id == sequence_id)

    async def submit_storyboard(self, chapter_id: str, sequence_id: str, body: StoryboardRequest) -> StoryboardTaskRead:
        """在同一事务建立空白目标及冻结任务，重放不重复创建。"""
        sequence, chapter = await self._scene(chapter_id, sequence_id, lock=True)
        request = body.model_dump(mode='json')
        existing = await self.db.scalar(self._storyboards(sequence_id).where(
            Task.input_snapshot['storyboard_request']['request_id'].as_string() == body.request_id))
        if existing:
            if existing.input_snapshot['storyboard_request'] != request:
                raise RevisionConflict('分镜请求身份已用于另一份内容')
            return await self._storyboard_read(existing)
        objects = await self.read_objects(chapter_id, sequence_id)
        if objects.source_changed:
            raise ValueError('场次原文范围已变化，请先刷新对象准备')
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.text_model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        capability = None
        if body.production_model_id:
            production = await self.db.get(Model, body.production_model_id)
            if not production or production.category not in (ModelCategoryKey.image, ModelCategoryKey.video):
                raise ValueError('请选择可用的图片或视频生产模型')
            capability = await model_capability(self.db, production.id)
        canvas = await self.create_canvas(chapter_id, sequence_id, SceneCanvasCreate(name=body.name))
        available = {(asset.kind, asset.id) for asset in objects.assets}
        frozen_objects = [{
            'id': item.id, 'kind': item.kind, 'name': item.name, 'excerpt': item.excerpt,
            'asset_id': item.asset_id if (item.kind, item.asset_id) in available else None,
            'image_file_id': item.image_file_id if item.reference_state == 'ready' else None,
        } for item in objects.objects]
        files = sorted({item['image_file_id'] for item in frozen_objects if item['image_file_id']})
        if files:
            # A verified asset slot can own an image without a separate project FileUsage.
            # Freeze that already-authorized project association for this canvas and its undo history.
            linked = set(await self.db.scalars(select(FileUsage.file_id).where(
                FileUsage.project_id == self.project_id, FileUsage.file_id.in_(files))))
            for file_id in files:
                if file_id not in linked:
                    await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id,
                        chapter_id=chapter.id, usage_kind='canvas_storyboard_source', source_ref=f'{canvas.id}:{file_id}')
        args = {'mode': body.mode, 'script_text': sequence.source_text, 'source_version': canvas.document.fixed_source.chapter_version,
                'objects': frozen_objects, 'production_model_id': body.production_model_id,
                'production_capability': capability.model_dump(mode='json') if capability else None}
        task = await TaskService(self.db).submit(kind=STORYBOARD_KIND, title='忠实提取分镜', target_type='directing_sequence',
            target_id=sequence_id, project_id=self.project_id, provider_id=provider.id,
            inputs=[('prepared-reference', index, file_id) for index, file_id in enumerate(files)],
            snapshot={'storyboard_request': request, 'chapter_id': chapter.id, 'canvas_id': canvas.id,
                      'baseline': canvas.model_dump(mode='json'), 'model_id': model.id, 'model_name': model.name,
                      'provider_key': config.provider_key, 'run_args': args})
        return await self._storyboard_read(task)

    async def read_storyboard(self, chapter_id: str, sequence_id: str, task_id: str) -> StoryboardTaskRead:
        """只返回本场任务与候选，不泄露模型配置和冻结私有输入。"""
        await self._scene(chapter_id, sequence_id)
        task = await self.db.scalar(self._storyboards(sequence_id).where(Task.id == task_id))
        if task is None or task.input_snapshot.get('chapter_id') != chapter_id:
            raise HTTPException(404, 'Storyboard task not found in scene')
        return await self._storyboard_read(task)

    async def _storyboard_read(self, task: Task) -> StoryboardTaskRead:
        canvas_id = task.input_snapshot['canvas_id']
        candidate, pending = None, False
        if task.status == TaskStatus.succeeded:
            candidate = StoryboardCandidate.model_validate(task.result)
            canvas = await CanvasStore(self.db, self.project_id).get(canvas_id)
            receipt = await self.db.get(CanvasSaveReceipt, (canvas_id, 'storyboard:' + task.id))
            if receipt:
                candidate = None
            else:
                pending = canvas.revision != candidate.base_revision
        return StoryboardTaskRead(**self.task_read(task).model_dump(), canvas_id=canvas_id,
                                  candidate=candidate, pending_application=pending)

    async def complete_storyboard(self, task: Task, result: SceneStoryboard) -> StoryboardCandidate:
        """在冻结基线上校验真实共同文档，迟到结果仍可作为待应用候选。"""
        snapshot = task.input_snapshot
        canvas = await CanvasStore(self.db, self.project_id).get(snapshot['canvas_id'], lock=True)
        if canvas.sequence_id != task.target_id:
            raise ValueError('目标画布已不属于原场次')
        baseline = CanvasDocument.model_validate(snapshot['baseline']['document'])
        assembled = StoryboardAssembly(snapshot['run_args'], task.id, baseline).build(result)
        frozen_canvas = SimpleNamespace(id=canvas.id, document=baseline.model_dump(), detached_proofs=None,
                                        card_types={card.id: card.type for card in baseline.cards})
        prepared = await prepare_document(self.db, self.project_id, frozen_canvas, assembled.model_dump())
        return StoryboardCandidate(base_revision=snapshot['baseline']['revision'], document=prepared.document)
