"""当前单元指令建议的固定输入、任务身份和应用前冲突校验。"""
from app.core.contracts.directing.scene_timeline import SceneTimeline
from uuid import uuid4

from sqlalchemy import select

from app.core.contracts.directing.common import Source
from app.core.contracts.directing.unit_scope import UnitScopeProjection
from app.core.contracts.directing.scene_instruction import SceneInstructionPreview, SceneInstructionRequest, SceneInstructionResult, SceneInstructionSuggestionRead
from app.core.contracts.directing.scene_version import EditableSceneDesign
from app.core.contracts.directing.style import StyleRule
from app.models.llm import ModelCategoryKey, Provider
from app.models.task import Task
from app.services.directing.production import ProductionService
from app.services.directing.instruction_inputs import instruction_design, unit_scope
from app.services.directing.scene_design import SceneDesignService
from app.services.directing.store import RevisionConflict
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService


class SceneInstructionService(SceneDesignService):
    """复用版本归属、来源保护和执行准备检查，建议始终归属原单元。"""

    @staticmethod
    def _instruction_unit(content, unit_id):
        """按稳定身份查找，不以名称或列表位置替代失效目标。"""
        unit = next((row for row in content.units if row.id == unit_id), None)
        if unit is None:
            raise ValueError('当前单元不存在，请重新明确选择')
        return unit

    async def _prepared(self, sequence_id, unit, text="准备检查"):
        """业务缺项允许保存，但发起指令前需明确当前拍摄输入。"""
        if not unit.model_id or not unit.duration_ms or any(not item.action_scope.strip() for item in unit.coverage):
            raise ValueError('当前单元准备未完成，请补齐模型、时长和动作范围')
        return await ProductionService(self.db, self.project_id).validate_prepared_unit(sequence_id, unit, text)

    def _instruction_tasks(self, sequence_id, version_id, unit_id=None):
        """查询范围包含项目、场次、版本与单元，防止跨对象采用结果。"""
        return select(Task).where(Task.project_id == self.project_id, Task.target_id == sequence_id,
            Task.kind == 'directing_instruction',
            Task.input_snapshot['scene_instruction']['version_id'].as_string() == version_id,
            *([Task.input_snapshot['scene_instruction']['unit_id'].as_string() == unit_id] if unit_id else []))

    async def submit_instruction(self, sequence_id, version_id, unit_id, body):
        """按原请求核实未知结果；同单元有活动任务时拒绝另一提交。"""
        sequence, current = await self._version(sequence_id, version_id)
        query = self._instruction_tasks(sequence_id, version_id, unit_id)
        tasks = list(await self.db.scalars(query))
        for task in tasks:
            request = SceneInstructionRequest.model_validate(task.input_snapshot['scene_instruction']['request'])
            if request.request_id == body.request_id:
                if request != body:
                    raise RevisionConflict('指令请求身份已用于另一份输入')
                return task
        if any(task.status not in {'succeeded', 'failed', 'cancelled'} for task in tasks):
            raise RevisionConflict('本单元已有指令任务，请先核实或取消')
        if current.revision != body.expected_revision:
            raise RevisionConflict('场次版本已变化，请重新核对后提交')
        unit = self._instruction_unit(body.content, unit_id)
        if body.scope:
            body.scope.validate_text(unit.instruction)
        design = instruction_design(body.content.design, unit)
        files = await self._validate_content(sequence, version_id, body.content.model_copy(update={'units': [unit], 'design': design, 'take_judgments': [], 'timeline': SceneTimeline()}))
        await self.require_scene_dependencies(sequence_id, version_id, unit, body.content)
        await self._prepared(sequence_id, unit)
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        video_model = await get_model_by_category(self.db, ModelCategoryKey.video, model_or_id=unit.model_id)
        rules = await self.applicable_style(body.content.design.style_revision_id, sequence_id, video_model.name)
        args = {'task_identity': uuid4().hex, 'basis': body.content.basis.model_dump(mode='json'),
            'design': design.model_dump(mode='json'), 'design_scope_version': 1, 'unit': unit.model_dump(mode='json'),
            'scope': unit_scope(body.content.design, unit, rules).model_dump(mode='json'),
            'requirements': body.requirements, 'instruction_scope': body.scope.model_dump() if body.scope else None,
            'video_model_name': video_model.name,
            'style_rules': [rule.model_dump(mode='json') for rule in rules]}
        return await TaskService(self.db).submit(kind='directing_instruction', title='生成当前单元指令建议',
            target_type='directing_sequence', target_id=sequence_id, project_id=self.project_id, provider_id=provider.id,
            inputs=[('instruction-source', index, file_id) for index, file_id in enumerate(sorted(files))],
            snapshot={'scene_instruction': {'version_id': version_id, 'unit_id': unit_id, 'request': body.model_dump(mode='json')},
                'model_id': model.id, 'model_name': model.name, 'provider_key': config.provider_key, 'run_args': args})

    async def list_instructions(self, sequence_id, version_id, unit_id):
        """返回本单元记录和固定输入；历史读取不重新发起任务。"""
        await self.read_scene_version(sequence_id, version_id)
        tasks = await self.db.scalars(self._instruction_tasks(sequence_id, version_id, unit_id).order_by(Task.created_at.desc(), Task.id.desc()))
        rows = []
        for task in tasks:
            request = SceneInstructionRequest.model_validate(task.input_snapshot['scene_instruction']['request'])
            result = SceneInstructionResult.model_validate(task.result) if task.status == 'succeeded' else None
            args = task.input_snapshot['run_args']
            rows.append(SceneInstructionSuggestionRead(task_id=task.id, request_id=request.request_id, status=task.status,
                error=task.error_message, requirements=request.requirements, scope=request.scope,
                unit_scope=args.get('scope'), basis=request.content.basis,
                generation_model_id=task.input_snapshot.get('model_id'), generation_model_name=task.input_snapshot.get('model_name'),
                video_model_name=args.get('video_model_name'), style_rules=args.get('style_rules'),
                design=EditableSceneDesign.model_validate(args['design']), unit=self._instruction_unit(request.content, unit_id), text=result.text if result else None))
        return rows

    @staticmethod
    def _matches_instruction_snapshot(content, unit, request, args):
        """沿原投影版本核对建议输入；图只读比较与明确预览使用相同规则。"""
        design = instruction_design(content.design, unit) if args.get('design_scope_version') == 1 else content.design
        design_changed = (not unit_scope(content.design, unit,
                          [StyleRule.model_validate(row) for row in args.get('style_rules') or []],
                          version=args['scope'].get('version', 1)).same_video_consumption(
                              UnitScopeProjection.model_validate(args['scope']))
                          if args.get('scope') else design != EditableSceneDesign.model_validate(args['design']))
        return (content.basis == request.content.basis and not design_changed
                and unit == SceneInstructionService._instruction_unit(request.content, unit.id))

    async def preview_instruction(self, sequence_id, version_id, unit_id, task_id, content):
        """仅本单元与设计依据一致时返回整份建议；别的单元编辑不阻止应用。"""
        sequence, _ = await self._version(sequence_id, version_id)
        task = await self.db.scalar(self._instruction_tasks(sequence_id, version_id, unit_id).where(Task.id == task_id))
        if task is None or task.status != 'succeeded':
            raise ValueError('本单元指令建议不存在或尚未成功完成')
        request = SceneInstructionRequest.model_validate(task.input_snapshot['scene_instruction']['request'])
        unit = self._instruction_unit(content, unit_id)
        args = task.input_snapshot['run_args']
        design = instruction_design(content.design, unit) if args.get('design_scope_version') == 1 else content.design
        if not self._matches_instruction_snapshot(content, unit, request, args):
            raise RevisionConflict('本单元正文或生成依据已变化，请核对差异后重新生成建议')
        await self._validate_content(sequence, version_id, content.model_copy(update={'units': [unit], 'design': design, 'take_judgments': [], 'timeline': SceneTimeline()}))
        await self._prepared(sequence_id, unit)
        result = SceneInstructionResult.model_validate(task.result)
        if result.unit_id != unit_id:
            raise ValueError('建议更改了单元身份，整次拒绝应用')
        if request.scope:
            request.scope.validate_text(unit.instruction, result.text)
        return SceneInstructionPreview(**result.model_dump(), task_id=task.id,
            source=Source(kind='model', reference=task.input_snapshot['run_args']['task_identity'], version='1'))
