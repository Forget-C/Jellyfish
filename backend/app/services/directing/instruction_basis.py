"""单元正文依据的独立确认、输入快照及状态核对。"""
from app.core.contracts.directing.scene_timeline import SceneTimeline
from app.core.contracts.directing.instruction_basis import InstructionBasisConfirm, InstructionBasisRead, InstructionInputs
from app.core.contracts.directing.scene_instruction import SceneInstructionApply, SceneInstructionRequest
from app.core.contracts.directing.scene_version import EditableUnitPreparation
from app.models.task import Task
from app.models.llm import ModelCategoryKey
from app.services.directing.instruction_inputs import instruction_design
from app.services.directing.scene_instruction import SceneInstructionService
from app.services.directing.store import RevisionConflict
from app.services.llm.resolver import get_model_by_category


class InstructionBasisService(SceneInstructionService):
    """确认只建立不可变回执，不保存正文，也不产生检查通过状态。"""

    async def _inputs(self, sequence, version_id, unit_id, content):
        unit = self._instruction_unit(content, unit_id)
        design = instruction_design(content.design, unit)
        files = await self._validate_content(sequence, version_id, content.model_copy(update={'units': [unit], 'design': design, 'take_judgments': [], 'timeline': SceneTimeline()}))
        name = None
        if unit.model_id:
            model = await get_model_by_category(self.db, ModelCategoryKey.video, model_or_id=unit.model_id)
            name = model.name
        rules = await self.applicable_style(design.style_revision_id, sequence.id, name)
        preparation = EditableUnitPreparation.model_validate(unit.model_dump(exclude={'instruction', 'instruction_source', 'instruction_basis_id', 'instruction_check_task_id'}))
        return InstructionInputs(basis=content.basis, design=design, unit=preparation, video_model_name=name, style_rules=rules), files

    async def basis_status(self, sequence_id, version_id, unit_id, content):
        """比较实际相关输入；普通保存和其他单元的编辑不会重写原依据。"""
        await self.read_scene_version(sequence_id, version_id)
        sequence = await self.sequence(sequence_id)
        unit = self._instruction_unit(content, unit_id)
        current, _ = await self._inputs(sequence, version_id, unit_id, content)
        previous = None
        if unit.instruction_basis_id:
            row = await self.instruction_basis(version_id, unit_id, unit.instruction_basis_id)
            previous = InstructionInputs.model_validate(row.inputs)
        status = 'empty' if not unit.instruction.strip() else 'unbound' if previous is None else 'current' if previous == current else 'changed'
        return InstructionBasisRead(basis_id=unit.instruction_basis_id, status=status, previous=previous, current=current)

    async def confirm_basis(self, sequence_id, version_id, unit_id, body):
        """显式确认绑定原请求；重复核实返回原回执，不自动更新保存基线。"""
        sequence, version = await self._version(sequence_id, version_id)
        row = await self.find_instruction_basis_request(version_id, unit_id, body)
        if row is None:
            if body.expected_revision != version.revision:
                raise RevisionConflict('场次版本已变化，请重新核对正文和依据')
            unit = self._instruction_unit(body.content, unit_id)
            if not unit.instruction.strip():
                raise ValueError('请先填写指令正文再确认依据')
            inputs, files = await self._inputs(sequence, version_id, unit_id, body.content)
            row = await self.create_instruction_basis(sequence, version_id, unit_id, body, inputs, files)
        inputs = InstructionInputs.model_validate(row.inputs)
        return InstructionBasisRead(basis_id=row.id, status='current', previous=inputs, current=inputs)

    async def apply_instruction(self, sequence_id, version_id, unit_id, task_id, content):
        """明确应用才创建依据回执；重复请求复用原回执，不直接保存当前版本。"""
        preview = await self.preview_instruction(sequence_id, version_id, unit_id, task_id, content)
        sequence = await self.sequence(sequence_id)
        inputs, files = await self._inputs(sequence, version_id, unit_id, content)
        task = await self.db.scalar(self._instruction_tasks(sequence_id, version_id, unit_id).where(Task.id == task_id))
        args = task.input_snapshot['run_args']
        if (args.get('video_model_name') != inputs.video_model_name
                or args.get('style_rules') != [rule.model_dump(mode='json') for rule in inputs.style_rules]):
            raise RevisionConflict('模型或适用风格与原建议依据不一致，请重新生成建议或人工核对正文')
        request = SceneInstructionRequest.model_validate(task.input_snapshot['scene_instruction']['request'])
        # 幂等身份取自原任务，正文取自已核实结果；不把无关单元的新编辑写进原回执请求。
        original = request.content
        updated = self._instruction_unit(original, unit_id).model_copy(update={'instruction': preview.text, 'instruction_source': preview.source})
        body = InstructionBasisConfirm(request_id=f'ai:{task_id}', expected_revision=request.expected_revision,
            content=original.model_copy(update={'units': [updated]}))
        row = await self.find_instruction_basis_request(version_id, unit_id, body)
        if row is None:
            row = await self.create_instruction_basis(sequence, version_id, unit_id, body, inputs, files)
        return SceneInstructionApply(**preview.model_dump(), basis_id=row.id)
