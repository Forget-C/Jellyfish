"""提交文本分镜任务并校验初次共同画布候选，不绕过画布保存。"""

from hashlib import sha256
from types import SimpleNamespace
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import select

from app.core.contracts.directing.scene_canvas import SceneCanvasCreate
from app.core.contracts.directing.scene_objects import SceneObjectsRead
from app.core.contracts.directing.scene_storyboard import (SceneStoryboard, StoryboardApplication, StoryboardBasis,
    StoryboardBasisObject, StoryboardCandidate, StoryboardCheckRequest, StoryboardConflictChoice, StoryboardContinuityDiff,
    StoryboardDiff, StoryboardDiffCard, StoryboardReextractRequest, StoryboardRepairResult, StoryboardRequest,
    StoryboardRestore, StoryboardReviewReport,
    StoryboardRetry, StoryboardRetryBasis, StoryboardTaskRead, StoryboardTaskSummary)
from app.core.contracts.task import TERMINAL_TASK_STATUSES, TaskStatus
from app.models.generation_canvas import CanvasSaveReceipt, GenerationCanvas
from app.models.llm import Model, ModelCategoryKey, Provider
from app.models.studio import FileItem, FileUsage
from app.models.task import Task
from app.schemas.generation_canvas import CanvasDocument, CanvasFixedSource, CanvasModelCapability, CanvasRead, CanvasSave, CreativeBasisCard
from app.services.directing.scene_canvas import SCENE_TASK_ORDER
from app.services.directing.existing_storyboard_check import STORYBOARD_CHECK_KIND, patch_saved_design, saved_repair_fields
from app.services.directing.scene_objects import SceneObjectService
from app.services.directing.store import RevisionConflict
from app.services.directing.storyboard_application import plan_application
from app.services.directing.storyboard_stack_review import review_stack_changes
from app.services.generation_canvas.errors import diagnostic
from app.services.directing.storyboard_assembly import STORYBOARD_KIND, StoryboardAssembly
from app.services.directing.storyboard_review import review_state
from app.services.directing.storyboard_review_basis import (
    canvas_review_fingerprint, capture_review_basis, evidence_digest, risk_basis,
)
from app.services.directing.storyboard_repair import repair_fields
from app.services.directing.storyboard_reference_cleanup import card_name
from app.services.generation_canvas.catalog import CARD_TITLES
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.document_save import prepare_document
from app.services.directing.storyboard_save import StoryboardSaveEvidence, applied_risks
from app.services.generation_canvas.store import CanvasStore
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.studio.file_usages import upsert_file_usage
from app.services.task_service import TaskService


class SceneStoryboardService(SceneObjectService):
    """场次范围内提交和读取，不依赖旧场次版本或媒体执行许可。"""

    def _storyboards(self, sequence_id: str):
        return self._scene_tasks(sequence_id, STORYBOARD_KIND)

    def _scene_tasks(self, sequence_id: str, kind: str | None = None):
        """Read one check or extraction by scope without mixing their discovery lists."""
        kinds = (kind,) if kind else (STORYBOARD_KIND, STORYBOARD_CHECK_KIND)
        return select(Task).where(Task.kind.in_(kinds), Task.project_id == self.project_id,
                                  Task.target_type == 'directing_sequence', Task.target_id == sequence_id)

    async def saved_check(self, chapter_id: str, sequence_id: str, canvas_id: str,
                          body: StoryboardCheckRequest | None = None) -> StoryboardTaskRead | None:
        """Read the latest check, or admit an explicitly selected saved revision."""
        sequence, _ = await self._scene(chapter_id, sequence_id, lock=body is not None)
        store = CanvasStore(self.db, self.project_id)
        canvas = await store.get(canvas_id, lock=body is not None)
        if canvas.sequence_id != sequence_id:
            raise HTTPException(404, 'Canvas not found in scene')
        query = self._scene_tasks(sequence_id, STORYBOARD_CHECK_KIND).where(
            Task.input_snapshot['canvas_id'].as_string() == canvas_id,
            Task.input_snapshot['chapter_id'].as_string() == chapter_id)
        if body is None:
            latest = await self.db.scalar(query.order_by(SCENE_TASK_ORDER.desc(), Task.created_at.desc(), Task.id.desc()).limit(1))
            return await self._storyboard_read(latest) if latest else None
        request = body.model_dump(mode='json')
        existing = await self.db.scalar(query.where(
            Task.input_snapshot['storyboard_request']['request_id'].as_string() == body.request_id))
        if existing:
            if existing.input_snapshot['storyboard_request'] != request:
                raise RevisionConflict('检查请求身份已用于另一份内容')
            return await self._storyboard_read(existing)
        if not sequence.is_current or canvas.revision != body.expected_revision:
            raise RevisionConflict('画布修订已变化，请重新核对')
        document = CanvasDocument.model_validate(canvas.document)
        if not document.storyboard or not document.storyboard.shots or not document.fixed_source:
            raise ValueError('画布尚无已保存的分镜可供检查')
        await self._ensure_no_active_storyboard(sequence_id, canvas_id)
        applied = await self.db.get(Task, document.storyboard.task_id)
        model = await get_model_by_category(self.db, ModelCategoryKey.text,
            model_or_id=applied.input_snapshot.get('model_id') if applied else None)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        fixed = next(card for card in document.cards if card.id == document.fixed_source.card_id)
        task = await TaskService(self.db).submit(kind=STORYBOARD_CHECK_KIND, title='检查分镜连续性',
            target_type='directing_sequence', target_id=sequence_id, project_id=self.project_id, provider_id=provider.id,
            snapshot={'scene_admission_order': await self._next_scene_task_order(sequence_id), 'chapter_id': chapter_id,
                      'canvas_id': canvas_id, 'storyboard_request': request, 'check_revision': canvas.revision,
                      'check_document': document.model_dump(mode='json'), 'review_basis': capture_review_basis(document),
                      'model_id': model.id, 'model_name': model.name, 'provider_key': config.provider_key,
                      'run_args': {'mode': document.storyboard.mode, 'script_text': fixed.text, 'objects': [],
                                   'production_model_id': None, 'pending_modality': 'video'}})
        return await self._storyboard_read(task)

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
            'image_file_id': None,
            'reference_unavailable': item.reference_state == 'unavailable',
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
        # 当前状态仅供创建前核对，不参与依据身份，也不补写历史依据。
        states = {item.id: item.reference_state for item in objects.objects} if canvas is None else {}
        return StoryboardBasis(token=token, source_text=text, source_changed=source_version != chapter_version,
            preparation_revision=objects.revision, preparation_stale=objects.source_changed,
            object_task_active=active_task_id is not None, objects=[StoryboardBasisObject(
                id=item['id'], name=item['name'], excerpt=item['excerpt'], kind=item['kind'], asset_id=item['asset_id'],
                asset_name=names.get((item['kind'], item['asset_id'])), image_file_id=item['image_file_id'],
                reference_unavailable=item['reference_unavailable'], reference_state=states.get(item['id']),
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
        other_intent = body.regenerate or body.targeted_repair or body.review_plan
        review_only = self._review_source(failed) or failed.kind == STORYBOARD_CHECK_KIND
        if body.correction_notes.strip() and (other_intent or review_only):
            raise ValueError("纠错意见仅用于分镜结构纠错")
        if body.regenerate and (body.structure_choice_id or body.targeted_repair or body.review_plan):
            raise ValueError('重新生成不能同时选择局部纠错')
        if body.review_plan:
            if body.targeted_repair or body.use_saved_objects or body.basis_token:
                raise ValueError('请单独提交本次画布方案的审查选择')
            return await self._review_changed_plan(chapter_id, sequence_id, failed, body)
        if body.targeted_repair:
            return await self._targeted_repair(chapter_id, sequence_id, failed, body)
        if failed.status not in (TaskStatus.failed, TaskStatus.cancelled):
            raise RevisionConflict('只有失败或取消的分镜任务可以重试')
        if not body.regenerate and (self._review_source(failed) or failed.kind == STORYBOARD_CHECK_KIND):
            return await self._retry_review(chapter_id, sequence_id, failed, body)
        request = self._retry_request(failed, body.request_id, body.basis_token, use_saved=body.use_saved_objects)
        return await self._submit(chapter_id, sequence_id, request,
                                  canvas_id=failed.input_snapshot['canvas_id'], retry_of_task_id=task_id, regenerate=body.regenerate, structure_choice_id=body.structure_choice_id, correction_notes=body.correction_notes.strip())

    @staticmethod
    def _retry_request(failed: Task, request_id: str, basis_token: str | None = None, *,
                       use_saved: bool = False, preview: bool = False) -> StoryboardReextractRequest:
        """保留原任务实际文本模型，单独记录本次确认依据。"""
        config = {**{key: value for key, value in failed.input_snapshot['storyboard_request'].items()
                     if key not in ('regenerate', 'structure_choice_id', 'correction_notes')}, 'request_id': request_id,
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
        if self._review_source(failed) or failed.kind == STORYBOARD_CHECK_KIND:
            await self._ensure_no_active_storyboard(sequence_id, failed.input_snapshot['canvas_id'])
            await self._ensure_not_retried(sequence_id, task_id)
            preview = await self._review_retry_basis(sequence, failed)
            return StoryboardRetryBasis.model_validate({**preview.model_dump(), **await self._storyboard_retry_presentation(failed)})
        body = self._retry_request(failed, 'preview', preview=True)
        canvas, prior_task_id = await self._reextract_baseline(sequence, chapter, failed.input_snapshot['canvas_id'], body, lock=False)
        await self._ensure_no_active_storyboard(sequence_id, canvas.id)
        await self._ensure_not_retried(sequence_id, task_id)
        objects = await self.read_objects(chapter_id, sequence_id)
        inputs = await self._inputs_for_canvas(sequence, canvas, prior_task_id, objects)
        model, production, capability = await self._storyboard_models(body)
        settings = self._retry_settings(task_id, body, model, production, capability)
        basis = await self._storyboard_basis(sequence, chapter, objects, inputs, canvas=canvas, settings=settings)
        from app.services.directing.storyboard_structure import readable_structure_options
        saved_structure = ((failed.result or {}).get('storyboard_structure')
                           or failed.input_snapshot['run_args'].get('structure_resume') or {})
        return StoryboardRetryBasis(canvas_id=canvas.id, basis=basis,
            **await self._storyboard_retry_presentation(failed),
            source_kind='confirmed_scene' if body.adopt_current_source else 'fixed',
            previous_correction_notes=failed.input_snapshot.get('storyboard_request', {}).get('correction_notes', ''),
            structure_only=bool(((failed.result or {}).get('storyboard_structure') or failed.input_snapshot['run_args'].get('structure_resume') or {}).get('draft')),
            structure_issues=((failed.result or {}).get('storyboard_structure') or failed.input_snapshot['run_args'].get('structure_resume') or {}).get('issues', []),
            structure_options=readable_structure_options(saved_structure, failed.input_snapshot['run_args']['objects']),
            mode=body.mode, text_model_name=model.name, production_model_id=body.production_model_id,
            production_model_name=production.name if production else None, pending_modality=body.pending_modality or 'image')

    async def _storyboard_retry_presentation(self, failed: Task) -> dict:
        """Keep attempt outcomes separate from validation of the exact retained draft."""
        from app.services.directing.storyboard_structure import structure_attempt, user_structure_issues
        lineage, seen = [], set()
        current = failed
        while current and current.id not in seen:
            if (current.project_id != failed.project_id or current.target_id != failed.target_id
                    or current.input_snapshot.get('canvas_id') != failed.input_snapshot.get('canvas_id')):
                break
            seen.add(current.id)
            lineage.append(current)
            current = await self.db.get(Task, current.retry_of_task_id) if current.retry_of_task_id else None
        saved = (failed.result or {}).get('storyboard_structure') or failed.input_snapshot.get('run_args', {}).get('structure_resume') or {}
        draft = saved.get('draft')
        evidence = saved
        if 'draft_issues' not in saved:
            for ancestor in lineage[1:]:
                older = (ancestor.result or {}).get('storyboard_structure') or ancestor.input_snapshot.get('run_args', {}).get('structure_resume') or {}
                if older.get('draft') != draft:
                    break
                evidence = older
        issues = evidence.get('draft_issues', evidence.get('issues', [])) if draft else []
        converted = user_structure_issues({**evidence, 'issues': issues},
                                         failed.input_snapshot.get('run_args', {}).get('objects', []))
        return {'user_issues': [issue for issue in converted if issue['title'] not in ('上次纠错未采用', '需要调整处理方式')],
                'current_attempt': structure_attempt(failed), 'history': [structure_attempt(task) for task in lineage[1:]]}

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
        existing = await self.db.scalar(self._scene_tasks(sequence_id, failed.kind).where(
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
        source_id = self._review_source(failed) or failed.id
        source = failed if source_id == failed.id else await self.db.get(Task, source_id)
        resume_stage = 'rechecking_storyboard' if (source.result or {}).get('review_repair') else 'reviewing_storyboard'
        return await self._submit_review_resume(sequence_id, failed, body, source_id, resume_stage)

    async def _targeted_repair(self, chapter_id: str, sequence_id: str, task: Task, body: StoryboardRetry) -> StoryboardTaskRead:
        """Authorize one conflict-specific attempt from the currently reviewed candidate."""
        sequence, _ = await self._scene(chapter_id, sequence_id, lock=True)
        existing = await self.db.scalar(self._scene_tasks(sequence_id, task.kind).where(
            Task.input_snapshot['storyboard_request']['request_id'].as_string() == body.request_id))
        if existing:
            if existing.retry_of_task_id != task.id or existing.input_snapshot.get('review_retry_request') != body.model_dump(mode='json'):
                raise RevisionConflict('分镜请求身份已用于另一份内容')
            return await self._storyboard_read(existing)
        if not sequence.is_current:
            raise RevisionConflict('历史场次不能修正分镜')
        canvas = await CanvasStore(self.db, self.project_id).get(task.input_snapshot['canvas_id'], lock=True)
        await self._ensure_no_active_storyboard(sequence_id, canvas.id)
        choice = body.targeted_repair
        diff = await self.apply_storyboard(chapter_id, sequence_id, task.id, StoryboardApplication(
            expected_revision=choice.expected_revision, overwrite_card_ids=choice.overwrite_card_ids), preview=True)
        review = diff.continuity_review
        if not review or review.stale or review.token != choice.review_token:
            raise diagnostic('STORYBOARD_REVIEW_STALE', '分镜审查依据已变化，请重新核对', {'canvas_id': canvas.id}, status=409)
        selected = next((item for item in review.conflicts if item.id == choice.conflict_id and item.can_repair), None)
        if not selected:
            raise diagnostic('STORYBOARD_REPAIR_REQUIRED_TARGET', '此冲突没有可定向修正的提议', {'canvas_id': canvas.id}, status=409)
        return await self._submit_review_resume(sequence_id, task, body, task.id, 'repairing_storyboard',
            {'issue': selected.issue.model_dump(mode='json'), 'report': task.result['review']})

    async def _review_changed_plan(self, chapter_id: str, sequence_id: str, task: Task, body: StoryboardRetry) -> StoryboardTaskRead:
        """Review a different merge of the retained draft without running extraction again."""
        sequence, _ = await self._scene(chapter_id, sequence_id, lock=True)
        existing = await self.db.scalar(self._scene_tasks(sequence_id, task.kind).where(
            Task.input_snapshot['storyboard_request']['request_id'].as_string() == body.request_id))
        if existing:
            if existing.retry_of_task_id != task.id or existing.input_snapshot.get('review_retry_request') != body.model_dump(mode='json'):
                raise RevisionConflict('分镜请求身份已用于另一份内容')
            return await self._storyboard_read(existing)
        if not (sequence.is_current and task.status == TaskStatus.succeeded and task.input_snapshot.get('reextract_canvas_id')
                and (task.result or {}).get('review_draft')):
            raise RevisionConflict('此分镜草案不能重新审查合并方案，请重新提取分镜')
        canvas = await CanvasStore(self.db, self.project_id).get(task.input_snapshot['canvas_id'], lock=True)
        await self._ensure_no_active_storyboard(sequence_id, canvas.id)
        diff = await self.apply_storyboard(chapter_id, sequence_id, task.id,
            StoryboardApplication(**body.review_plan.model_dump()), preview=True)
        if not diff.continuity_review or not diff.continuity_review.can_review_plan:
            raise RevisionConflict('当前分镜方案已审查，请核对已有结果')
        overwritten = body.review_plan.overwrite_card_ids
        review_basis = capture_review_basis(CanvasDocument.model_validate(canvas.document), overwrite_card_ids=overwritten)
        return await self._submit_review_resume(sequence_id, task, body, task.id, 'reviewing_storyboard',
            review_plan={'review_current_document': canvas.document, 'review_overwrite_card_ids': overwritten,
                         'review_basis': review_basis, 'review_exact_plan': True})

    async def _submit_review_resume(self, sequence_id: str, source: Task, body: StoryboardRetry, source_id: str,
                                    stage: str, repair: dict | None = None, *, review_plan: dict | None = None) -> StoryboardTaskRead:
        snapshot = source.input_snapshot
        files = sorted({item['image_file_id'] for item in snapshot['run_args']['objects'] if item.get('image_file_id')})
        task = await TaskService(self.db).submit(kind=source.kind, title='重试分镜审查',
            target_type='directing_sequence', target_id=sequence_id, project_id=self.project_id,
            provider_id=source.provider_id, retry_of_task_id=source.id,
            inputs=[('prepared-reference', index, file_id) for index, file_id in enumerate(files)],
            snapshot={**snapshot, **(review_plan or {}), 'scene_admission_order': await self._next_scene_task_order(sequence_id),
                'storyboard_request': {**snapshot['storyboard_request'], 'request_id': body.request_id},
                'review_retry_request': body.model_dump(mode='json'), 'review_retry_from': source_id, 'review_retry_stage': stage,
                'review_targeted_repair': None if review_plan else repair or snapshot.get('review_targeted_repair')})
        return await self._storyboard_read(task)

    async def _ensure_no_active_storyboard(self, sequence_id: str, canvas_id: str) -> None:
        if await self.db.scalar(self._scene_tasks(sequence_id).with_only_columns(Task.id).where(
                Task.input_snapshot['canvas_id'].as_string() == canvas_id,
                Task.status.not_in(TERMINAL_TASK_STATUSES)).limit(1)):
            raise RevisionConflict('该画布已有进行中的分镜任务')

    async def _ensure_not_retried(self, sequence_id: str, task_id: str) -> None:
        if await self.db.scalar(self._scene_tasks(sequence_id).with_only_columns(Task.id)
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
                      *, canvas_id: str | None = None, retry_of_task_id: str | None = None, regenerate: bool = False,
                      structure_choice_id: str | None = None, correction_notes: str = "") -> StoryboardTaskRead:
        sequence, chapter = await self._scene(chapter_id, sequence_id, lock=True)
        request = body.model_dump(mode='json')
        if correction_notes:
            request['correction_notes'] = correction_notes
        if regenerate:
            request['regenerate'] = True
        if structure_choice_id:
            request['structure_choice_id'] = structure_choice_id
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
                'objects': model_objects, 'scene_object_sequence_id': sequence_id, 'production_model_id': body.production_model_id, 'pending_modality': body.pending_modality or 'image',
                'production_capability': capability.model_dump(mode='json') if capability else None}
        if retry_of_task_id and not regenerate:
            failed = await self.db.get(Task, retry_of_task_id)
            saved = ((failed.result or {}).get('storyboard_structure')
                     or failed.input_snapshot['run_args'].get('structure_resume'))
            prior_args = {key: value for key, value in failed.input_snapshot['run_args'].items() if key != 'structure_resume'}
            if saved and saved.get('draft'):
                if prior_args != args:
                    raise RevisionConflict('提取依据已变化，无法继续原草案纠错，请明确选择重新生成')
                options = saved.get('options', [])
                selected = next((option for option in options if option['id'] == structure_choice_id), None)
                if options and not selected and not correction_notes:
                    raise RevisionConflict('请先选择本次结构纠错方案')
                if structure_choice_id and not selected:
                    raise ValueError('纠错方案已失效，请重新核对')
                args['structure_resume'] = {**saved, 'selected_option': selected, 'correction_notes': correction_notes}
        if correction_notes and 'structure_resume' not in args:
            raise ValueError('没有可继续纠错的保留草案')
        protected = await self.storyboard_repair_protections(canvas.id, sequence_id) if canvas_id else set()
        current = (await CanvasStore(self.db, self.project_id).get(canvas.id)).document if canvas_id else canvas.document
        review_basis = capture_review_basis(CanvasDocument.model_validate(current))
        task = await TaskService(self.db).submit(kind=STORYBOARD_KIND,
            title='生成完整分镜' if body.mode == 'complete' else '忠实提取分镜', target_type='directing_sequence',
            target_id=sequence_id, project_id=self.project_id, provider_id=provider.id, retry_of_task_id=retry_of_task_id,
            inputs=[('prepared-reference', index, file_id) for index, file_id in enumerate(files)],
            snapshot={'scene_admission_order': await self._next_scene_task_order(sequence_id), 'storyboard_request': request, 'chapter_id': chapter.id, 'canvas_id': canvas.id,
                      'reextract_canvas_id': canvas_id, 'baseline': canvas.model_dump(mode='json'), 'model_id': model.id, 'model_name': model.name,
                      'provider_key': config.provider_key, 'run_args': args,
                      'review_protected_designs': sorted(protected), 'review_basis': review_basis,
                      **({'review_current_document': current} if canvas_id else {})})
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
            if task.kind != STORYBOARD_KIND:
                return None
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
        task = await self.db.scalar(self._scene_tasks(sequence_id).where(Task.id == task_id))
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
        if body.review_token:
            confirmation['review_token'] = body.review_token
        if body.accepted_conflict_ids:
            confirmation['accepted_conflict_ids'] = sorted(body.accepted_conflict_ids)
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
        if task.kind == STORYBOARD_CHECK_KIND:
            document, diff = self._plan_saved_check(task, current, body)
        else:
            document, diff = await self.plan_extraction(task, current, candidate.document, body)
        diff.automatic_stacks, diff.manual_stacks = review_stack_changes(current, document)
        continuity = await self._continuity_diff(task, current, document)
        diff.continuity_review = continuity
        if preview:
            return diff
        evidence = StoryboardSaveEvidence.confirm(task, current, document, body, continuity,
                                                   has_changes=bool(diff.modified))
        if diff.manual_stacks:
            stack = diff.manual_stacks[0]
            raise diagnostic('STACK_READ_ONLY', f'请先手动解除堆叠「{stack.name}」，再核对提取差异', {'group_id': stack.id})
        affected = {stack.id for stack in diff.automatic_stacks}
        if sorted(affected) != sorted(body.confirmed_auto_stack_ids):
            raise diagnostic('STORYBOARD_STACK_CONFIRMATION_REQUIRED', '请重新核对并确认本次应用将解除的自动堆叠', {'canvas_id': canvas.id})
        document.groups = [group for group in document.groups if group.id not in affected]
        return await store.save_scene_application(canvas,
            CanvasSave(request_id=request_id, expected_revision=body.expected_revision, document=document.model_dump()),
            digest, chapter_version=sha256(chapter.raw_text.encode()).hexdigest(), evidence=evidence)

    async def plan_extraction(self, task: Task, current: CanvasDocument, candidate: CanvasDocument,
                              body: StoryboardApplication) -> tuple[CanvasDocument, StoryboardDiff]:
        """Use identical preservation and adoption rules for review and application."""
        previous = await self.db.get(Task, current.storyboard.task_id) if current.storyboard else None
        prior = None
        if previous and previous.kind == STORYBOARD_KIND and previous.target_id == task.target_id and previous.project_id == self.project_id and previous.status == TaskStatus.succeeded:
            prior = StoryboardCandidate.from_task_result(previous.result).document
        return plan_application(current, candidate, body, prior=prior,
                                production_capability=task.input_snapshot['run_args'].get('production_capability'))

    @staticmethod
    def _plan_saved_check(task: Task, current: CanvasDocument, body: StoryboardApplication) -> tuple[CanvasDocument, StoryboardDiff]:
        """Reapply only the reviewed field patches on the current layout."""
        if body.overwrite_card_ids:
            raise ValueError('检查修正不能覆盖人工卡片')
        planned = current.model_copy(deep=True)
        modified = set()
        if canvas_review_fingerprint(current) == task.input_snapshot['review_basis']['all']:
            for batch in task.result.get('check_patches', ()):
                _, changed = patch_saved_design(planned, StoryboardReviewReport.model_validate({'issues': [batch['issue']]}),
                                                StoryboardRepairResult.model_validate(batch['edits']))
                if not changed:
                    raise diagnostic('STORYBOARD_REVIEW_STALE', '原检查修正已无法安全应用', {'canvas_id': current.id}, status=409)
                modified.update(changed)
        return planned, StoryboardDiff(added=[], removed=[], orphaned=[], source_changed=False,
            modified=[StoryboardDiffCard(id=card.id, type=card.type, name=card_name(card), type_name=CARD_TITLES[card.type])
                      for card in planned.cards if card.id in modified])

    async def _continuity_diff(self, task: Task, current: CanvasDocument, planned: CanvasDocument) -> StoryboardContinuityDiff | None:
        """Bind findings and prior decisions to the exact preview of adopted design."""
        result = task.result or {}
        if result.get('review') is None:
            return None
        report = StoryboardReviewReport.model_validate(result['review'])
        basis = task.input_snapshot.get('review_basis')
        latest = capture_review_basis(current, overwrite_card_ids=task.input_snapshot.get('review_overwrite_card_ids', ()))
        relevant = {shot for issue in report.issues for shot in issue.shot_ids}
        stale = bool(basis and (
            any(basis['shots'].get(shot, basis['shared']) != latest['shots'].get(shot, latest['shared']) for shot in relevant)
            if relevant and task.kind != STORYBOARD_CHECK_KIND else basis['all'] != latest['all']))
        planned_fingerprint = canvas_review_fingerprint(planned)
        reextract = task.kind == STORYBOARD_KIND and bool(task.input_snapshot.get('reextract_canvas_id'))
        if reextract:
            # The merged plan can mask a new edit to a card selected for overwrite.
            stale = not basis or basis['all'] != latest['all'] or result.get('reviewed_plan_fingerprint') != planned_fingerprint
        active, _ = await applied_risks(self.db, current)
        draft = SceneStoryboard.model_validate(result['review_draft']) if result.get('review_draft') else None
        protected = {origin.semantic_key for origin in current.storyboard.origins.values()
                     if origin.manually_edited} if current.storyboard else set()
        choices = {}
        for issue in report.issues:
            if issue.kind != 'conflict':
                continue
            key = evidence_digest({'requirements': issue.requirements, 'shots': sorted(issue.shot_ids),
                                   'basis': risk_basis(planned, issue.shot_ids)})
            issue_report = StoryboardReviewReport(issues=[issue])
            eligible = (saved_repair_fields(planned, issue_report) if task.kind == STORYBOARD_CHECK_KIND and planned.storyboard
                        else draft and task.input_snapshot['run_args']['mode'] == 'complete' and repair_fields(
                            draft, issue_report, protected))
            choices[key] = StoryboardConflictChoice(id=key, issue=issue, previously_accepted=key in active, can_repair=bool(eligible))
        token = evidence_digest({'task': task.id, 'current': latest['all'], 'planned': planned_fingerprint,
                                 'choices': sorted(choices)})
        return StoryboardContinuityDiff(token=token, stale=stale, conflicts=list(choices.values()),
                                       can_review_plan=reextract and stale and bool(draft))

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
        current = CanvasDocument.model_validate(canvas.document)
        document = CanvasDocument.model_validate(body.document)
        evidence = await StoryboardSaveEvidence.restore(self.db, canvas, sequence_id, task.id,
                                                        current, document, body.direction)
        return await store.save_scene_application(canvas,
            CanvasSave(request_id=body.request_id, expected_revision=body.expected_revision, document=document.model_dump()),
            digest, chapter_version=sha256(chapter.raw_text.encode()).hexdigest(), evidence=evidence)

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
        summary = self._storyboard_summary(task, canvas_id, candidate is not None).model_dump()
        applied = CanvasDocument.model_validate(canvas.document)
        accepted = set()
        saved_check = task.kind == STORYBOARD_CHECK_KIND
        active_check = applied.storyboard.continuity_check_task_id if applied.storyboard else None
        if active_check == task.id or (not active_check and applied.storyboard and applied.storyboard.task_id == task.id):
            accepted, stale = await applied_risks(self.db, applied)
            if stale or accepted:
                summary['review_state'] = 'stale' if stale else 'accepted'
        if saved_check:
            if task.status == TaskStatus.succeeded:
                basis = (canvas_review_fingerprint(CanvasDocument.model_validate(task.result['document']))
                         if active_check == task.id else task.input_snapshot['review_basis']['all'])
                if (canvas_review_fingerprint(applied) != basis
                        or (active_check != task.id and candidate is None and task.result.get('check_patches'))):
                    summary['review_state'] = 'stale'
                pending = bool(candidate and (task.result.get('check_patches') or task.result.get('review_state') == 'conflict'))
            elif summary['review_state'] is None:
                summary['review_state'] = review_state(task.status, 'pending')
        return StoryboardTaskRead(**summary, candidate=candidate, pending_application=pending,
            structure_issues=((task.result or {}).get('storyboard_structure') or (task.result or {}).get('structure_history') or {}).get('issues', []),
            repair_details=(task.result or {}).get('repair_details'),
            review=(task.result or {}).get('review'), accepted_conflict_ids=sorted(accepted), saved_check=saved_check,
            reviewed_overwrite_card_ids=task.input_snapshot.get('review_overwrite_card_ids', []))

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
