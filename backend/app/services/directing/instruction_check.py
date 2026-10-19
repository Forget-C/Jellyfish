"""单元指令检查的明确提交、固定输入与历史结果读取。"""
from sqlalchemy import select

from app.core.contracts.directing.instruction_check import InstructionCheckConfirmation, InstructionCheckComparison, InstructionCheckRead, InstructionCheckRequest, InstructionCheckResult
from app.core.contracts.directing.instruction_basis import InstructionInputs
from app.models.llm import ModelCategoryKey, Provider
from app.models.task import Task
from app.models.directing import SceneCopyOrigin
from app.services.directing.instruction_basis import InstructionBasisService
from app.services.directing.store import RevisionConflict
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService


class InstructionCheckService(InstructionBasisService):
    """检查不会更新依据绑定、修改正文或自动发起视频。"""

    def _checks(self, sequence_id, version_id, unit_id):
        return select(Task).where(Task.project_id == self.project_id, Task.target_id == sequence_id,
            Task.kind == 'directing_instruction_check',
            Task.input_snapshot['instruction_check']['version_id'].as_string() == version_id,
            Task.input_snapshot['instruction_check']['unit_id'].as_string() == unit_id)

    async def submit_check(self, sequence_id, version_id, unit_id, body):
        """原请求核实优先于新提交检查；新任务要求依据已明确确认且准备齐备。"""
        sequence, version = await self._version(sequence_id, version_id)
        tasks = list(await self.db.scalars(self._checks(sequence_id, version_id, unit_id)))
        for task in tasks:
            request = InstructionCheckRequest.model_validate(task.input_snapshot['instruction_check']['request'])
            if request.request_id == body.request_id:
                if request != body:
                    raise RevisionConflict('检查请求身份已用于另一份输入')
                return task
        if any(task.status not in {'succeeded', 'failed', 'cancelled'} for task in tasks):
            raise RevisionConflict('本单元已有检查任务，请先核实或取消')
        if body.expected_revision != version.revision:
            raise RevisionConflict('场次版本已变化，请重新核对后检查')
        state = await self.basis_status(sequence_id, version_id, unit_id, body.content)
        if state.status != 'current':
            raise RevisionConflict('请先按当前依据更新并明确确认指令，检查不能解除依据已变')
        unit = self._instruction_unit(body.content, unit_id)
        await self.require_scene_dependencies(sequence_id, version_id, unit, body.content)
        inputs, files = await self._inputs(sequence, version_id, unit_id, body.content)
        if inputs.scope and inputs.scope.unresolved:
            raise ValueError('单元适用范围待核对：' + '；'.join(inputs.scope.unresolved))
        await self._prepared(sequence_id, unit)
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        return await TaskService(self.db).submit(kind='directing_instruction_check', title='检查当前单元指令',
            target_type='directing_sequence', target_id=sequence_id, project_id=self.project_id, provider_id=provider.id,
            inputs=[('check-source', index, file_id) for index, file_id in enumerate(sorted(files))],
            snapshot={'instruction_check': {'version_id': version_id, 'unit_id': unit_id, 'request': body.model_dump(mode='json')},
                'model_id': model.id, 'model_name': model.name, 'provider_key': config.provider_key,
                'run_args': {'inputs': inputs.model_dump(mode='json'), 'instruction': unit.instruction,
                             'destination_contract_version': 1}})

    async def list_checks(self, sequence_id, version_id, unit_id):
        """历史读取不依赖当前编辑的完整性，不修改或采纳任何结论。"""
        await self.read_scene_version(sequence_id, version_id)
        tasks = list(await self.db.scalars(self._checks(sequence_id, version_id, unit_id).order_by(Task.created_at.desc(), Task.id.desc())))
        origin = await self.db.get(SceneCopyOrigin, version_id)
        original = next((row for row in origin.request['content']['units'] if row['id'] == unit_id), None) if origin else None
        inherited_id = original.get('instruction_check_task_id') if original else None
        if inherited_id and not any(task.id == inherited_id for task in tasks):
            tasks.append(await self.scene_instruction_check_task(sequence_id, version_id, unit_id, inherited_id))
        rows = []
        for task in tasks:
            args = task.input_snapshot['run_args']
            inputs = InstructionInputs.model_validate(args['inputs'])
            result = InstructionCheckResult.model_validate(task.result).validate_scope(
                unit_id, [item.id for item in inputs.unit.coverage], scope=inputs.scope,
                instruction=args['instruction'], references=inputs.unit.references,
                require_destinations=args.get('destination_contract_version') == 1) if task.status == 'succeeded' else None
            rows.append(InstructionCheckRead(task_id=task.id, origin_version_id=task.input_snapshot['instruction_check']['version_id'], request_id=task.input_snapshot['instruction_check']['request']['request_id'],
                status=task.status, error=task.error_message, instruction=args['instruction'], inputs=inputs,
                model_name=task.input_snapshot['model_name'], result=result))
        return rows

    async def compare_check(self, sequence_id, version_id, unit_id, task_id, content):
        """只读比较实际输入；无关单元不参与，也不改写历史结果或确认状态。"""
        await self.read_scene_version(sequence_id, version_id)
        task = await self.scene_instruction_check_task(sequence_id, version_id, unit_id, task_id)
        state = await self.basis_status(sequence_id, version_id, unit_id, content)
        args = task.input_snapshot['run_args']
        unit = self._instruction_unit(content, unit_id)
        matches = unit.instruction == args['instruction'] and state.current.same_consumption(InstructionInputs.model_validate(args['inputs']))
        confirmed = False
        if unit.instruction_check_task_id == task.id and matches and state.status == 'current':
            await self.confirmable_instruction_check(sequence_id, version_id, unit_id, task_id)
            confirmed = True
        return InstructionCheckComparison(task_id=task.id, basis_current=state.status == 'current',
            matches_current=matches, confirmed=confirmed)

    async def confirm_check(self, sequence_id, version_id, unit_id, task_id, content):
        """明确核对当前检查，返回身份供一次编辑绑定，不替用户保存或执行视频。"""
        await self._version(sequence_id, version_id)
        compared = await self.compare_check(sequence_id, version_id, unit_id, task_id, content)
        if not compared.matches_current or not compared.basis_current:
            raise RevisionConflict('正文或依据已变化，请更新并重新检查后核对结果')
        await self.confirmable_instruction_check(sequence_id, version_id, unit_id, task_id)
        return InstructionCheckConfirmation(task_id=task_id)
