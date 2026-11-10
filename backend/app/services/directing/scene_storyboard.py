"""提交文本分镜任务并校验初次共同画布候选，不绕过画布保存。"""

from hashlib import sha256
from types import SimpleNamespace
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import select

from app.core.contracts.directing.scene_canvas import SceneCanvasCreate
from app.core.contracts.directing.scene_objects import SceneObjectsRead
from app.core.contracts.directing.scene_storyboard import (SceneStoryboard, StoryboardApplication, StoryboardBasis,
    StoryboardBasisObject, StoryboardCandidate, StoryboardReextractRequest, StoryboardRequest, StoryboardRestore,
    StoryboardRetry, StoryboardRetryBasis, StoryboardTaskRead, StoryboardTaskSummary)
from app.core.contracts.task import TERMINAL_TASK_STATUSES, TaskStatus
from app.models.generation_canvas import CanvasSaveReceipt, GenerationCanvas
from app.models.llm import Model, ModelCategoryKey, Provider
from app.models.studio import FileItem, FileUsage
from app.models.task import Task
from app.schemas.generation_canvas import CanvasDocument, CanvasFixedSource, CanvasModelCapability, CanvasRead, CanvasSave, CreativeBasisCard
from app.services.directing.scene_canvas import SCENE_TASK_ORDER
from app.services.directing.scene_objects import SceneObjectService
from app.services.directing.store import RevisionConflict
from app.services.directing.storyboard_application import plan_application
from app.services.directing.storyboard_continuity_choices import visual_continuity_state
from app.services.directing.storyboard_stack_review import review_stack_changes
from app.services.generation_canvas.errors import diagnostic
from app.services.directing.storyboard_assembly import STORYBOARD_KIND, StoryboardAssembly
from app.services.directing.storyboard_review import require_storyboard_review, review_state
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.document_save import fixed_source_state, prepare_document
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
        return await self._submit(chapter_id, sequence_id, body)

    async def read_storyboard_basis(self, chapter_id: str, sequence_id: str) -> StoryboardBasis:
        """返回创建前可核对的场次摘录和经过验证的参考。"""
        sequence, chapter = await self._scene(chapter_id, sequence_id)
        if not sequence.is_current or not sequence.source_text.strip():
            raise RevisionConflict('此场次没有可用的已确认原文')
        objects = await self.read_objects(chapter_id, sequence_id)
        return await self._storyboard_basis(sequence, chapter, objects, self._prepared_object_inputs(objects))

    @staticmethod
    def _prepared_object_inputs(objects: SceneObjectsRead) -> list[dict]:
        available = {(asset.kind, asset.id) for asset in objects.assets}
        return [{
            'id': item.id, 'kind': item.kind, 'name': item.name, 'excerpt': item.excerpt,
            'asset_id': item.asset_id if (item.kind, item.asset_id) in available else None,
            'image_file_id': item.image_file_id if item.reference_state == 'ready' else None,
            'reference_unavailable': bool(item.image_file_id and item.reference_state != 'ready'),
        } for item in objects.objects]

    async def _storyboard_basis(self, sequence, chapter, objects: SceneObjectsRead, inputs: list[dict],
                                *, canvas: CanvasRead | None = None, settings: dict | None = None) -> StoryboardBasis:
        """标记用户所见依据的变化，排队到运行的阶段更新不改变选择。"""
        active_task_id = await self.db.scalar(self._tasks(sequence.id).with_only_columns(Task.id)
            .where(Task.status.not_in(TERMINAL_TASK_STATUSES)).limit(1))
        chapter_version = sha256(chapter.raw_text.encode()).hexdigest()
        source = sequence.source
        text = sequence.source_text
        source_version = source.get('version')
        target = {}
        if canvas:
            fixed, evidence = self._canvas_evidence(canvas)
            source_version, text = fixed.chapter_version, evidence.text
            target = {'canvas_id': canvas.id, 'revision': canvas.revision,
                      'fixed_source': fixed.model_dump(mode='json'), 'evidence': evidence.model_dump(mode='json'),
                      'settings': settings}
        token = CanvasStore.command_digest({
            'scene_id': sequence.id, 'chapter_version': chapter_version, 'source': source, **target,
            'start': sequence.source_start, 'end': sequence.source_end, 'text': text,
            'preparation_revision': objects.revision, 'preparation_stale': objects.source_changed, 'objects': inputs,
            'active_task_id': active_task_id,
        })
        names = {(asset.kind, asset.id): asset.name for asset in objects.assets}
        return StoryboardBasis(token=token, source_text=text, source_changed=source_version != chapter_version,
            preparation_revision=objects.revision, preparation_stale=objects.source_changed,
            object_task_active=active_task_id is not None, objects=[StoryboardBasisObject(
                id=item['id'], name=item['name'], excerpt=item['excerpt'], kind=item['kind'], asset_id=item['asset_id'],
                asset_name=names.get((item['kind'], item['asset_id'])), image_file_id=item['image_file_id'],
                reference_unavailable=item['reference_unavailable'],
            ) for item in inputs])

    async def reextract_storyboard(self, chapter_id: str, sequence_id: str, canvas_id: str,
                                   body: StoryboardReextractRequest) -> StoryboardTaskRead:
        """Keep the canvas identity and freeze the selected, verified text evidence."""
        return await self._submit(chapter_id, sequence_id, body, canvas_id=canvas_id)

    async def retry_storyboard(self, chapter_id: str, sequence_id: str, task_id: str,
                               body: StoryboardRetry) -> StoryboardTaskRead:
        """保留原配置与画布身份，仍按当前画布基线组织差异。"""
        await self._scene(chapter_id, sequence_id)
        failed = await self._get_storyboard(chapter_id, sequence_id, task_id)
        if failed.status not in (TaskStatus.failed, TaskStatus.cancelled):
            raise RevisionConflict('只有失败或取消的分镜任务可以重试')
        if self._review_source(failed):
            return await self._retry_review(chapter_id, sequence_id, failed, body)
        request = self._retry_request(failed, body.request_id, body.basis_token, use_saved=body.use_saved_objects)
        return await self._submit(chapter_id, sequence_id, request,
                                  canvas_id=failed.input_snapshot['canvas_id'], retry_of_task_id=task_id)

    @staticmethod
    def _retry_request(failed: Task, request_id: str, basis_token: str | None = None, *,
                       use_saved: bool = False, preview: bool = False) -> StoryboardReextractRequest:
        """保留原任务实际文本模型，单独记录本次确认依据。"""
        config = {**failed.input_snapshot['storyboard_request'], 'request_id': request_id,
                  'basis_token': basis_token, 'use_saved_objects': use_saved}
        if basis_token or preview:
            config['text_model_id'] = failed.input_snapshot['model_id']
        return StoryboardReextractRequest.model_validate(config)

    async def read_storyboard_retry_basis(self, chapter_id: str, sequence_id: str, task_id: str) -> StoryboardRetryBasis:
        """先核对真实原画布，预览与提交共用输入及模型解析。"""
        sequence, chapter = await self._scene(chapter_id, sequence_id)
        failed = await self._get_storyboard(chapter_id, sequence_id, task_id)
        if not sequence.is_current:
            raise RevisionConflict('历史场次不能重试分镜')
        if failed.status not in (TaskStatus.failed, TaskStatus.cancelled):
            raise RevisionConflict('只有失败或取消的分镜任务可以重试')
        if self._review_source(failed):
            await self._ensure_no_active_storyboard(sequence_id, failed.input_snapshot['canvas_id'])
            await self._ensure_not_retried(sequence_id, task_id)
            return await self._review_retry_basis(sequence, failed)
        body = self._retry_request(failed, 'preview', preview=True)
        canvas, prior_task_id = await self._reextract_baseline(sequence, chapter, failed.input_snapshot['canvas_id'], body, lock=False)
        await self._ensure_no_active_storyboard(sequence_id, canvas.id)
        await self._ensure_not_retried(sequence_id, task_id)
        objects = await self.read_objects(chapter_id, sequence_id)
        inputs = await self._inputs_for_canvas(sequence, canvas, prior_task_id, objects)
        model, production, capability = await self._storyboard_models(body)
        settings = self._retry_settings(task_id, body, model, production, capability)
        basis = await self._storyboard_basis(sequence, chapter, objects, inputs, canvas=canvas, settings=settings)
        return StoryboardRetryBasis(canvas_id=canvas.id, basis=basis,
            source_kind='confirmed_scene' if body.adopt_current_source else 'fixed',
            mode=body.mode, text_model_name=model.name, production_model_id=body.production_model_id,
            production_model_name=production.name if production else None, pending_modality=body.pending_modality or 'image')

    @staticmethod
    def _review_source(task: Task) -> str | None:
        """A retry can itself fail before the worker has opened the frozen draft."""
        return task.id if (task.result or {}).get('review_state') == 'pending' else task.input_snapshot.get('review_retry_from')

    async def _review_retry_basis(self, sequence, failed: Task) -> StoryboardRetryBasis:
        """Preview the original draft inputs without adopting a newer source or references."""
        snapshot = failed.input_snapshot
        canvas = await CanvasStore(self.db, self.project_id).get(snapshot['canvas_id'])
        if canvas.sequence_id != sequence.id:
            raise HTTPException(404, 'Canvas not found in scene')
        args = snapshot['run_args']
        config = snapshot['storyboard_request']
        token = CanvasStore.command_digest({'retry_review': failed.id, 'source': self._review_source(failed)})
        objects = [StoryboardBasisObject.model_validate({key: item[key] for key in (
            'id', 'kind', 'name', 'excerpt', 'asset_id', 'image_file_id')}) for item in args['objects']]
        basis = StoryboardBasis(token=token, source_text=args['script_text'], source_changed=False,
            preparation_revision=0, preparation_stale=False, object_task_active=False, objects=objects)
        production = await self.db.get(Model, args['production_model_id']) if args['production_model_id'] else None
        return StoryboardRetryBasis(canvas_id=canvas.id, basis=basis, review_only=True,
            source_kind='confirmed_scene' if config.get('adopt_current_source') else 'fixed',
            mode=args['mode'], text_model_name=snapshot['model_name'], production_model_id=args['production_model_id'],
            production_model_name=production.name if production else None, pending_modality=args['pending_modality'])

    async def _retry_review(self, chapter_id: str, sequence_id: str, failed: Task, body: StoryboardRetry) -> StoryboardTaskRead:
        sequence, _ = await self._scene(chapter_id, sequence_id, lock=True)
        request = body.model_dump(mode='json')
        existing = await self.db.scalar(self._storyboards(sequence_id).where(
            Task.input_snapshot['storyboard_request']['request_id'].as_string() == body.request_id))
        if existing:
            if existing.retry_of_task_id != failed.id or existing.input_snapshot.get('review_retry_request') != request:
                raise RevisionConflict('分镜请求身份已用于另一份内容')
            return await self._storyboard_read(existing)
        if not sequence.is_current:
            raise RevisionConflict('历史场次不能重试分镜')
        await self._ensure_not_retried(sequence_id, failed.id)
        basis = await self._review_retry_basis(sequence, failed)
        await self._ensure_no_active_storyboard(sequence_id, basis.canvas_id)
        if body.use_saved_objects or (body.basis_token and body.basis_token != basis.basis.token):
            raise RevisionConflict('审查须沿用原分镜草案，请重新核对重试依据')
        snapshot = failed.input_snapshot
        files = sorted({item['image_file_id'] for item in snapshot['run_args']['objects'] if item.get('image_file_id')})
        source_id = self._review_source(failed)
        source = failed if source_id == failed.id else await self.db.get(Task, source_id)
        resume_stage = 'rechecking_storyboard' if (source.result or {}).get('review_repair') else 'reviewing_storyboard'
        task = await TaskService(self.db).submit(kind=STORYBOARD_KIND, title='重试分镜审查',
            target_type='directing_sequence', target_id=sequence_id, project_id=self.project_id,
            provider_id=failed.provider_id, retry_of_task_id=failed.id,
            inputs=[('prepared-reference', index, file_id) for index, file_id in enumerate(files)],
            snapshot={**snapshot, 'scene_admission_order': await self._next_scene_task_order(sequence_id),
                'storyboard_request': {**snapshot['storyboard_request'], 'request_id': body.request_id},
                'review_retry_request': request, 'review_retry_from': source_id, 'review_retry_stage': resume_stage})
        return await self._storyboard_read(task)

    async def _ensure_no_active_storyboard(self, sequence_id: str, canvas_id: str) -> None:
        if await self.db.scalar(self._storyboards(sequence_id).with_only_columns(Task.id).where(
                Task.input_snapshot['canvas_id'].as_string() == canvas_id,
                Task.status.not_in(TERMINAL_TASK_STATUSES)).limit(1)):
            raise RevisionConflict('该画布已有进行中的分镜任务')

    async def _ensure_not_retried(self, sequence_id: str, task_id: str) -> None:
        if await self.db.scalar(self._storyboards(sequence_id).with_only_columns(Task.id)
                .where(Task.retry_of_task_id == task_id).limit(1)):
            raise RevisionConflict('已提交该任务的重试，请查看最新分镜任务')

    async def _storyboard_models(self, body: StoryboardRequest) -> tuple[Model, Model | None, CanvasModelCapability | None]:
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.text_model_id)
        if not body.production_model_id:
            return model, None, None
        production = await self.db.get(Model, body.production_model_id)
        if not production or production.category not in (ModelCategoryKey.image, ModelCategoryKey.video):
            raise ValueError('请选择可用的图片或视频生产模型')
        return model, production, await model_capability(self.db, production.id)

    @staticmethod
    def _retry_settings(task_id: str, body: StoryboardReextractRequest, model: Model, production: Model | None,
                        capability: CanvasModelCapability | None) -> dict:
        return {'retry_of': task_id, 'mode': body.mode, 'adopt_current_source': body.adopt_current_source,
                'text_model': [model.id, model.name], 'production_model': [production.id, production.name] if production else None,
                'pending_modality': body.pending_modality or 'image',
                'production_capability': capability.model_dump(mode='json') if capability else None}

    @staticmethod
    def _verify_basis(confirmed: StoryboardBasis, body: StoryboardRequest) -> None:
        if body.basis_token != confirmed.token:
            raise RevisionConflict('原文、画布或对象参考已变化，请重新核对生成依据')
        if confirmed.preparation_stale:
            raise ValueError('场次原文范围已变化，请先刷新对象准备')
        if confirmed.object_task_active and (not body.use_saved_objects or not confirmed.preparation_revision):
            raise RevisionConflict('对象提取进行中，请等待或明确使用已保存对象继续')

    async def _submit(self, chapter_id: str, sequence_id: str, body: StoryboardRequest,
                      *, canvas_id: str | None = None, retry_of_task_id: str | None = None) -> StoryboardTaskRead:
        sequence, chapter = await self._scene(chapter_id, sequence_id, lock=True)
        request = body.model_dump(mode='json')
        existing = await self.db.scalar(self._storyboards(sequence_id).where(
            Task.input_snapshot['storyboard_request']['request_id'].as_string() == body.request_id))
        if existing:
            snapshot = existing.input_snapshot
            if (snapshot['storyboard_request'] != request or snapshot.get('reextract_canvas_id') != canvas_id
                    or existing.retry_of_task_id != retry_of_task_id):
                raise RevisionConflict('分镜请求身份已用于另一份内容')
            return await self._storyboard_read(existing)
        if not sequence.is_current:
            raise RevisionConflict('历史场次不能重新提取或重试分镜' if canvas_id else '历史场次不能新建分镜画布')
        if retry_of_task_id:
            await self._ensure_not_retried(sequence_id, retry_of_task_id)
        objects = await self.read_objects(chapter_id, sequence_id)
        prepared_inputs = self._prepared_object_inputs(objects)
        if not canvas_id and body.basis_token is not None:
            confirmed = await self._storyboard_basis(sequence, chapter, objects, prepared_inputs)
            self._verify_basis(confirmed, body)
        if objects.source_changed and not canvas_id:
            raise ValueError('场次原文范围已变化，请先刷新对象准备')
        model, production, capability = await self._storyboard_models(body)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        prior_task_id = None
        if canvas_id:
            canvas, prior_task_id = await self._reextract_baseline(sequence, chapter, canvas_id, body)
            await self._ensure_no_active_storyboard(sequence_id, canvas_id)
        else:
            canvas = await self.create_canvas(chapter_id, sequence_id, SceneCanvasCreate(name=body.name))
        fixed, basis = self._canvas_evidence(canvas)
        frozen_objects = await self._inputs_for_canvas(sequence, canvas, prior_task_id, objects)
        if retry_of_task_id and body.basis_token:
            settings = self._retry_settings(retry_of_task_id, body, model, production, capability)
            confirmed = await self._storyboard_basis(sequence, chapter, objects, frozen_objects, canvas=canvas, settings=settings)
            self._verify_basis(confirmed, body)

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
        # Availability labels belong to confirmation, not frozen model inputs.
        model_objects = [{key: value for key, value in item.items() if key != 'reference_unavailable'} for item in frozen_objects]
        args = {'mode': body.mode, 'script_text': basis.text, 'source_version': fixed.chapter_version,
                'objects': model_objects, 'production_model_id': body.production_model_id, 'pending_modality': body.pending_modality or 'image',
                'production_capability': capability.model_dump(mode='json') if capability else None}
        protected = await self.storyboard_repair_protections(canvas.id, sequence_id) if canvas_id else set()
        task = await TaskService(self.db).submit(kind=STORYBOARD_KIND,
            title='生成完整分镜' if body.mode == 'complete' else '忠实提取分镜', target_type='directing_sequence',
            target_id=sequence_id, project_id=self.project_id, provider_id=provider.id, retry_of_task_id=retry_of_task_id,
            inputs=[('prepared-reference', index, file_id) for index, file_id in enumerate(files)],
            snapshot={'scene_admission_order': await self._next_scene_task_order(sequence_id), 'storyboard_request': request, 'chapter_id': chapter.id, 'canvas_id': canvas.id,
                      'reextract_canvas_id': canvas_id, 'baseline': canvas.model_dump(mode='json'), 'model_id': model.id, 'model_name': model.name,
                      'provider_key': config.provider_key, 'run_args': args,
                      'review_protected_designs': sorted(protected)})
        return await self._storyboard_read(task)

    @staticmethod
    def _canvas_evidence(canvas: CanvasRead) -> tuple[CanvasFixedSource, CreativeBasisCard]:
        fixed = canvas.document.fixed_source
        return fixed, next(card for card in canvas.document.cards if card.id == fixed.card_id)

    async def _inputs_for_canvas(self, sequence, canvas: CanvasRead, prior_task_id: str | None,
                                 objects: SceneObjectsRead) -> list[dict]:
        fixed, basis = self._canvas_evidence(canvas)
        if not objects.source_changed and (fixed.chapter_version, basis.selection_start, basis.text) == (
                sequence.source['version'], sequence.source_start, sequence.source_text):
            return self._prepared_object_inputs(objects)
        return await self._previous_object_inputs(canvas, prior_task_id, basis)

    async def _reextract_baseline(self, sequence, chapter, canvas_id: str,
                                  body: StoryboardReextractRequest, *, lock: bool = True) -> tuple[CanvasRead, str | None]:
        store = CanvasStore(self.db, self.project_id)
        row = await store.get(canvas_id, lock=lock)
        current = CanvasDocument.model_validate(row.document)
        fixed = current.fixed_source
        if row.sequence_id != sequence.id or not fixed or fixed.chapter_id != chapter.id:
            raise HTTPException(404, 'Canvas not found in scene')
        basis = next(card for card in current.cards if card.id == fixed.card_id)
        if body.adopt_current_source:
            version = self._confirmed_source_version(sequence, chapter)
            if (fixed.chapter_version, basis.text, basis.selection_start, basis.selection_end) != (
                    version, sequence.source_text, sequence.source_start, sequence.source_end):
                evidence = f'{canvas_id}:{version}:{sequence.source_start}:{sequence.source_end}'
                basis = CreativeBasisCard(id=uuid5(NAMESPACE_URL, evidence).hex, text=sequence.source_text,
                    source_locator=f'章节 {chapter.title} · 场次 {sequence.title}',
                    selection_start=sequence.source_start, selection_end=sequence.source_end)
                fixed = CanvasFixedSource(card_id=basis.id, chapter_id=chapter.id, chapter_version=version)
        seed = CanvasDocument(id=canvas_id, project_id=self.project_id, name=current.name,
                              cards=[basis], fixed_source=fixed)
        task_id = current.storyboard.task_id if current.storyboard else None
        return CanvasRead(id=canvas_id, project_id=self.project_id, revision=row.revision, document=seed), task_id

    async def _previous_object_inputs(self, canvas: CanvasRead, task_id: str | None, basis: CreativeBasisCard) -> list[dict]:
        if not task_id:
            return []
        task = await self.db.get(Task, task_id)
        if not task or task.kind != STORYBOARD_KIND or task.project_id != self.project_id or task.input_snapshot.get('canvas_id') != canvas.id:
            return []
        args = task.input_snapshot['run_args']
        if (args['source_version'], args['script_text']) != (canvas.document.fixed_source.chapter_version, basis.text):
            return []
        items = args['objects']
        file_ids = {item['image_file_id'] for item in items if item.get('image_file_id')}
        available = set(await self.db.scalars(select(FileItem.id).join(FileUsage, FileUsage.file_id == FileItem.id)
            .where(FileItem.id.in_(file_ids), FileItem.deleted_at.is_(None), FileItem.delete_requested_at.is_(None),
                   FileUsage.project_id == self.project_id))) if file_ids else set()
        return [{**item, 'image_file_id': item['image_file_id'] if item['image_file_id'] in available else None,
                 'reference_unavailable': bool(item['image_file_id'] and item['image_file_id'] not in available)} for item in items]

    @staticmethod
    def _confirmed_source_version(sequence, chapter) -> str:
        """Use only the scene range already confirmed against the current chapter."""
        version = sha256(chapter.raw_text.encode()).hexdigest()
        if not sequence.source_text.strip() or sequence.source.get('kind') != 'chapter' or (
                sequence.source.get('reference'), sequence.source.get('version')) != (chapter.id, version):
            raise RevisionConflict('章节原文已变动，请返回章节确认本场次的新原文范围')
        return version

    async def list_storyboards(self, chapter_id: str, sequence_id: str,
                               canvas_id: str | None = None) -> list[StoryboardTaskSummary]:
        """恢复入口只读取轻量状态，不加载完整分镜图。"""
        await self._scene(chapter_id, sequence_id)
        query = self._storyboards(sequence_id).where(Task.input_snapshot['chapter_id'].as_string() == chapter_id)
        target = Task.input_snapshot['canvas_id'].as_string()
        if canvas_id:
            member = await self.db.scalar(select(GenerationCanvas.id).where(GenerationCanvas.id == canvas_id,
                GenerationCanvas.project_id == self.project_id, GenerationCanvas.sequence_id == sequence_id))
            if not member:
                raise HTTPException(404, 'Canvas not found in scene')
            query = query.where(target == canvas_id)
        tasks = (await self.db.execute(query.with_only_columns(
            Task.id, Task.status, Task.stage, Task.error_message, Task.retry_of_task_id, target.label('canvas_id'),
            Task.result['review_state'].as_string().label('review_state'),
            Task.input_snapshot['review_retry_from'].as_string().label('review_retry_from'))
            .order_by(SCENE_TASK_ORDER.desc(), Task.created_at.desc(), Task.id.desc()).limit(20))).all()
        saved = set(await self.db.scalars(select(CanvasSaveReceipt.request_id).where(
            CanvasSaveReceipt.request_id.in_(['storyboard:' + task.id for task in tasks if task.status == TaskStatus.succeeded]))))
        return [self._storyboard_summary(task, task.canvas_id, task.status == TaskStatus.succeeded and 'storyboard:' + task.id not in saved)
                for task in tasks]

    def _storyboard_summary(self, task, canvas_id: str, candidate_available: bool) -> StoryboardTaskSummary:
        stored = task.review_state if hasattr(task, 'review_state') else (task.result or {}).get('review_state')
        retry_from = task.review_retry_from if hasattr(task, 'review_retry_from') else task.input_snapshot.get('review_retry_from')
        return StoryboardTaskSummary(**self.task_read(task).model_dump(), canvas_id=canvas_id,
            candidate_available=candidate_available, retry_of_task_id=task.retry_of_task_id,
            review_state=review_state(task.status, stored or ('pending' if retry_from else None)))

    async def read_canvas_candidate(self, chapter_id: str, sequence_id: str, canvas_id: str,
                                    task_id: str | None = None) -> StoryboardTaskRead | None:
        """按可信画布范围查找指定候选或最新成功结果，独立于近期任务列表。"""
        await self._scene(chapter_id, sequence_id)
        canvas = await CanvasStore(self.db, self.project_id).get(canvas_id)
        if canvas.sequence_id != sequence_id:
            raise HTTPException(404, 'Canvas not found in scene')
        if task_id:
            task = await self._get_storyboard(chapter_id, sequence_id, task_id)
            if task.input_snapshot.get('canvas_id') != canvas_id:
                raise HTTPException(404, 'Storyboard task not found in canvas')
        else:
            task = await self.db.scalar(self._storyboards(sequence_id).where(
                Task.input_snapshot['chapter_id'].as_string() == chapter_id,
                Task.input_snapshot['canvas_id'].as_string() == canvas_id,
                Task.status == TaskStatus.succeeded,
            ).order_by(SCENE_TASK_ORDER.desc(), Task.created_at.desc(), Task.id.desc()).limit(1))
        if task is None or task.status != TaskStatus.succeeded:
            return None
        result = await self._storyboard_read(task)
        return result if result.candidate is not None else None

    async def read_storyboard(self, chapter_id: str, sequence_id: str, task_id: str) -> StoryboardTaskRead:
        """只返回本场任务与候选，不泄露模型配置和冻结私有输入。"""
        await self._scene(chapter_id, sequence_id)
        return await self._storyboard_read(await self._get_storyboard(chapter_id, sequence_id, task_id))

    async def _get_storyboard(self, chapter_id: str, sequence_id: str, task_id: str) -> Task:
        task = await self.db.scalar(self._storyboards(sequence_id).where(Task.id == task_id))
        if task is None or task.input_snapshot.get('chapter_id') != chapter_id:
            raise HTTPException(404, 'Storyboard task not found in scene')
        return task

    async def apply_storyboard(self, chapter_id: str, sequence_id: str, task_id: str,
                               body: StoryboardApplication, *, preview: bool = False):
        """Compute the exact reviewed plan from the locked revision or replay its receipt."""
        sequence, chapter = await self._scene(chapter_id, sequence_id, lock=not preview)
        task = await self._get_storyboard(chapter_id, sequence_id, task_id)
        store = CanvasStore(self.db, self.project_id)
        canvas = await store.get(task.input_snapshot['canvas_id'], lock=not preview)
        request_id = 'storyboard:' + task.id
        confirmation = {'expected_revision': body.expected_revision, 'overwrite_card_ids': sorted(body.overwrite_card_ids)}
        if body.confirmed_auto_stack_ids:
            confirmation['confirmed_auto_stack_ids'] = sorted(body.confirmed_auto_stack_ids)
        digest = store.command_digest(confirmation)
        if not preview:
            receipt = await store.save_receipt(canvas.id, request_id, digest)
            if receipt:
                return CanvasRead.model_validate(receipt['scene_canvas'])
        if canvas.revision != body.expected_revision:
            raise diagnostic('REVISION_CONFLICT', '画布已更新，请重新核对提取差异', {'canvas_id': canvas.id}, status=409)
        if task.status != TaskStatus.succeeded or canvas.sequence_id != sequence_id:
            raise ValueError('本场分镜候选尚未可用')
        if await self.db.get(CanvasSaveReceipt, (canvas.id, request_id)):
            raise ValueError('这份分镜结果已经应用')
        candidate = StoryboardCandidate.from_task_result(task.result)
        current = CanvasDocument.model_validate(canvas.document)
        if task.input_snapshot['storyboard_request'].get('adopt_current_source'):
            version = self._confirmed_source_version(sequence, chapter)
            basis = next(card for card in candidate.document.cards if card.id == candidate.document.fixed_source.card_id)
            if (candidate.document.fixed_source.chapter_version, basis.text, basis.selection_start, basis.selection_end) != (
                    version, sequence.source_text, sequence.source_start, sequence.source_end):
                raise RevisionConflict('提取后原文范围再次变动，请重新提取')
        elif current.fixed_source != candidate.document.fixed_source:
            raise RevisionConflict('固定原文已更新，请重新提取')
        previous = await self.db.get(Task, current.storyboard.task_id) if current.storyboard else None
        prior = None
        if previous and previous.kind == STORYBOARD_KIND and previous.target_id == sequence_id and previous.project_id == self.project_id and previous.status == TaskStatus.succeeded:
            prior = StoryboardCandidate.from_task_result(previous.result).document
        capability = task.input_snapshot['run_args'].get('production_capability')
        document, diff = plan_application(current, candidate.document, body, prior=prior, production_capability=capability)
        diff.automatic_stacks, diff.manual_stacks = review_stack_changes(current, document)
        if preview:
            return diff
        require_storyboard_review(task, canvas.id)
        if diff.manual_stacks:
            stack = diff.manual_stacks[0]
            raise diagnostic('STACK_READ_ONLY', f'请先手动解除堆叠「{stack.name}」，再核对提取差异', {'group_id': stack.id})
        affected = {stack.id for stack in diff.automatic_stacks}
        if sorted(affected) != sorted(body.confirmed_auto_stack_ids):
            raise diagnostic('STORYBOARD_STACK_CONFIRMATION_REQUIRED', '请重新核对并确认本次应用将解除的自动堆叠', {'canvas_id': canvas.id})
        document.groups = [group for group in document.groups if group.id not in affected]
        return await store.save_scene_application(canvas,
            CanvasSave(request_id=request_id, expected_revision=body.expected_revision, document=document.model_dump()),
            digest, chapter_version=sha256(chapter.raw_text.encode()).hexdigest(),
            scene_sources=fixed_source_state(document),
            source_history={'before': self._history_state(current), 'after': self._history_state(document)})

    @staticmethod
    def _history_state(document: CanvasDocument) -> dict:
        state = {'sources': fixed_source_state(document), 'task_id': document.storyboard.task_id if document.storyboard else None}
        if continuity := visual_continuity_state(document):
            state['visual_continuity'] = continuity
        return state

    async def restore_storyboard(self, chapter_id: str, sequence_id: str, task_id: str,
                                 body: StoryboardRestore) -> CanvasRead:
        """Restore a fixed source only across a real application and its exact evidence."""
        _, chapter = await self._scene(chapter_id, sequence_id, lock=True)
        task = await self._get_storyboard(chapter_id, sequence_id, task_id)
        store = CanvasStore(self.db, self.project_id)
        canvas = await store.get(task.input_snapshot['canvas_id'], lock=True)
        digest = store.command_digest({'task_id': task_id, **body.model_dump(mode='json', exclude={'request_id'})})
        replay = await store.save_receipt(canvas.id, body.request_id, digest)
        if replay:
            return CanvasRead.model_validate(replay['scene_canvas'])
        if canvas.revision != body.expected_revision:
            raise diagnostic('REVISION_CONFLICT', '画布已更新，请重新读取后核对', {'canvas_id': canvas.id}, status=409)
        receipt = await self.db.get(CanvasSaveReceipt, (canvas.id, 'storyboard:' + task.id))
        history = receipt.response.get('source_history') if receipt else None
        from_side, to_side = ('after', 'before') if body.direction == 'undo' else ('before', 'after')
        current = CanvasDocument.model_validate(canvas.document)
        document = CanvasDocument.model_validate(body.document)
        if canvas.sequence_id != sequence_id or not history or self._history_state(current) != history[from_side] or (
                self._history_state(document) != history[to_side]):
            raise diagnostic('INVALID_STORYBOARD_RESTORE', '无法核对整批操作的原文与提取依据', {'canvas_id': canvas.id})
        return await store.save_scene_application(canvas,
            CanvasSave(request_id=body.request_id, expected_revision=body.expected_revision, document=document.model_dump()),
            digest, chapter_version=sha256(chapter.raw_text.encode()).hexdigest(), scene_sources=history[to_side]['sources'],
            restored_continuity=frozenset(history[to_side].get('visual_continuity', {})))

    async def _storyboard_read(self, task: Task) -> StoryboardTaskRead:
        canvas_id = task.input_snapshot['canvas_id']
        try:
            canvas = await CanvasStore(self.db, self.project_id).get(canvas_id)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            raise HTTPException(404, '此分镜任务的原画布已不可用') from error
        candidate, pending = None, False
        if task.status == TaskStatus.succeeded:
            candidate = StoryboardCandidate.from_task_result(task.result)
            receipt = await self.db.get(CanvasSaveReceipt, (canvas_id, 'storyboard:' + task.id))
            if receipt:
                candidate = None
            else:
                pending = (bool(task.input_snapshot.get('reextract_canvas_id') or task.input_snapshot.get('review_retry_from'))
                           or canvas.revision != candidate.base_revision or task.result.get('review_state') == 'conflict')
        return StoryboardTaskRead(**self._storyboard_summary(task, canvas_id, candidate is not None).model_dump(),
                                  candidate=candidate, pending_application=pending,
                                  review=(task.result or {}).get('review'))

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

    async def storyboard_repair_protections(self, canvas_id: str, sequence_id: str, *, lock: bool = False) -> set[str]:
        """Track manually changed generated designs at admission and before applying any repair."""
        canvas = await CanvasStore(self.db, self.project_id).get(canvas_id, lock=lock)
        if canvas.sequence_id != sequence_id:
            raise HTTPException(404, 'Canvas not found in scene')
        storyboard = (canvas.document or {}).get('storyboard') or {}
        return {origin['semantic_key'] for origin in storyboard.get('origins', {}).values()
                if origin.get('manually_edited')}
