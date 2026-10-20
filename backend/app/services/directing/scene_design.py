"""场次版本的 AI 建议冻结、预览与应用前校验；不改写可编辑内容。"""
from datetime import UTC
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import select

from app.core.contracts.directing.scene_design import SceneDesignDiagnostics, SceneDesignPreview, SceneDesignRequest, SceneDesignSuggestionRead, parse_scene_design_candidate
from app.core.contracts.directing.design_scope import design_scope_issues
from app.core.contracts.directing.scene_version import EditableSceneDesign, SceneVersionContent
from app.models.directing import SceneVersionRecord
from app.models.llm import ModelCategoryKey, Provider
from app.models.studio import Chapter, FileUsage
from app.models.task import Task
from app.services.directing.ai import DirectingAIService
from app.services.directing.store import RevisionConflict
from app.services.directing.scene_design_scope import validate_design_scope
from app.services.directing.scene_design_sources import validate_model_sources
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService


class SceneDesignService(DirectingAIService):
    """复用统一任务执行，版本与请求身份限定结果归属；预览不保存或采用。"""

    async def _version(self, sequence_id, version_id):
        """沿用章节到场次的锁顺序，退出当前划分的版本禁止新操作。"""
        sequence = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        sequence = await self.current_sequence(sequence_id)
        return sequence, await self.read_scene_version(sequence_id, version_id)

    async def _validate_content(self, sequence, version_id, content):
        """沿用存储的来源与引用校验，验证未保存输入但不将其落盘。"""
        row = await self.db.get(SceneVersionRecord, version_id)
        bases = await self._scene_source_bases(sequence, row, content.basis)
        basis = SimpleNamespace(id=sequence.id, chapter_id=sequence.chapter_id,
            source=content.basis.source.model_dump(mode='json'),
            source_versions={source.source.version for source in bases})
        previous = await self.read_scene_version(sequence.id, version_id)
        files = await self.validate_scene_content(basis, content, previous=previous.content)
        for file_id in sorted(files):
            projects = set(await self.db.scalars(select(FileUsage.project_id).where(FileUsage.file_id == file_id)))
            if projects and self.project_id not in projects:
                raise ValueError('来源文件仅属于其他项目，请先关联到当前项目')
        return files

    async def submit_design(self, sequence_id: str, version_id: str, body: SceneDesignRequest):
        """冻结明确的整场依据；结果不明时按原请求身份核实，不能重复提交。"""
        sequence, current = await self._version(sequence_id, version_id)
        existing = await self.db.scalar(select(Task).where(Task.project_id == self.project_id,
            Task.target_id == sequence_id, Task.kind == 'directing_design',
            Task.input_snapshot['scene_design']['version_id'].as_string() == version_id,
            Task.input_snapshot['scene_design']['request']['request_id'].as_string() == body.request_id))
        request = body.model_dump(mode='json')
        if existing is not None:
            if SceneDesignRequest.model_validate(existing.input_snapshot['scene_design']['request']) != body:
                raise RevisionConflict('AI 请求身份已用于另一份内容')
            return existing
        active = await self.db.scalar(select(Task.id).where(Task.project_id == self.project_id,
            Task.target_id == sequence_id, Task.kind == 'directing_design',
            Task.input_snapshot['scene_design']['version_id'].as_string() == version_id,
            Task.status.not_in(['succeeded', 'failed', 'cancelled'])))
        if active:
            raise RevisionConflict('本版本已有设计任务，请先核实本次结果或取消任务')
        if current.revision != body.expected_revision:
            raise RevisionConflict('场次版本已变化，请核对当前内容后重新发起')
        validate_design_scope(body.scope, body.content.design.model_dump(mode='json'))
        files = await self._validate_content(sequence, version_id, body.content)
        if not body.content.basis.text.strip():
            raise ValueError('请先明确本场原文依据')
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        style_id = body.content.design.style_revision_id
        rules = await self.applicable_style(style_id, sequence_id, model.name)
        args = {'scene_version_design': True, 'task_identity': uuid4().hex,
            'design_scope_version': 1,
            'design_candidate_version': 1,
            'design_scope': body.scope, 'instruction': body.instruction, 'script_text': body.content.basis.text,
            'source': body.content.basis.source.model_dump(mode='json'),
            'previous_design': body.content.design.model_dump(mode='json'),
            'scene_version_content': body.content.model_dump(mode='json'),
            'style_revision_id': style_id, 'style_rules': [rule.model_dump(mode='json') for rule in rules],
            'existing_assets': [asset.model_dump(mode='json') for asset in await self.assets()]}
        return await TaskService(self.db).submit(kind='directing_design', title='AI 局部修订' if body.scope else 'AI 提取设计 · 整场',
            target_type='directing_sequence', target_id=sequence_id, project_id=self.project_id,
            provider_id=provider.id, inputs=[('design-source', index, file_id) for index, file_id in enumerate(sorted(files))],
            snapshot={'scene_design': {'version_id': version_id, 'request': request},
                'model_id': model.id, 'model_name': model.name, 'provider_key': config.provider_key, 'run_args': args})

    async def list_design(self, sequence_id: str, version_id: str):
        """仅列出本方案任务；页面重载后核实状态，不靠本地缓存伪造任务归属。"""
        await self.read_scene_version(sequence_id, version_id)
        tasks = await self.db.scalars(select(Task).where(Task.project_id == self.project_id,
            Task.target_id == sequence_id, Task.kind == 'directing_design',
            Task.input_snapshot['scene_design']['version_id'].as_string() == version_id)
            .order_by(Task.created_at.desc(), Task.id.desc()))
        result = []
        for task in tasks:
            request = SceneDesignRequest.model_validate(task.input_snapshot['scene_design']['request'])
            candidate = (parse_scene_design_candidate(task.result, task.input_snapshot.get('run_args', {}))
                         if task.status == 'succeeded' else None)
            result.append(SceneDesignSuggestionRead(task_id=task.id, scope=request.scope, request_id=request.request_id,
                created_at=task.created_at.replace(tzinfo=UTC), status=task.status, error=task.error_message, instruction=request.instruction,
                basis=request.content.basis, before=request.content.design,
                design=candidate.design if candidate else EditableSceneDesign.model_validate(task.result) if task.status == 'succeeded' else None,
                issues=design_scope_issues(candidate.design) if candidate else [],
                candidate_attempt=candidate.attempt if candidate else None,
                diagnostics=candidate.diagnostics if candidate else (SceneDesignDiagnostics.model_validate(task.result['design_diagnostics'])
                    if task.status == 'failed' and task.result and 'design_diagnostics' in task.result else None)))
        return result

    async def preview_design(self, sequence_id: str, version_id: str, task_id: str, content: SceneVersionContent):
        """整份核实来源、当前编辑和引用；任何冲突均拒绝整次应用，不部分替换。"""
        sequence, _ = await self._version(sequence_id, version_id)
        task = await self.db.get(Task, task_id)
        if (task is None or task.project_id != self.project_id or task.target_id != sequence_id
                or task.kind != 'directing_design' or task.input_snapshot.get('scene_design', {}).get('version_id') != version_id):
            raise ValueError('建议不属于当前场次版本')
        if task.status != 'succeeded':
            raise ValueError('建议尚未成功完成，请查看本次任务')
        request = SceneDesignRequest.model_validate(task.input_snapshot['scene_design']['request'])
        original = request.content
        if content.basis != original.basis:
            raise RevisionConflict('原文依据已变化，请重新生成建议')
        if content.design != original.design:
            raise RevisionConflict('设计已变化，请核对新的人工编辑并重新生成建议')
        await self._validate_content(sequence, version_id, content)
        candidate = parse_scene_design_candidate(task.result, task.input_snapshot.get('run_args', {}))
        proposed = candidate.design if candidate else EditableSceneDesign.model_validate(task.result)
        validate_design_scope(request.scope, original.design.model_dump(mode='json'), proposed.model_dump(mode='json'))
        validate_model_sources(original.design, proposed, task.input_snapshot['run_args']['task_identity'])
        if proposed.style_revision_id != original.design.style_revision_id:
            raise ValueError('建议修改了本次范围外的项目风格依据')
        if request.scope is None and original.basis.source not in proposed.sources:
            proposed.sources.append(original.basis.source)
        await self._validate_content(sequence, version_id, content.model_copy(update={'design': proposed}))
        issues = []
        if request.scope is None and task.input_snapshot['run_args'].get('design_scope_version') == 1:
            issues = design_scope_issues(proposed)
            if issues and candidate is None:
                raise ValueError('整场设计未完整，不能应用：' + '；'.join(
                    f'{issue.owner}.{issue.field}：{issue.reason}' for issue in issues))
        return SceneDesignPreview(task_id=task.id, scope=request.scope, basis=original.basis,
            before=original.design, design=proposed, issues=issues)
