"""可编辑场次版本执行视频前的统一条件核验。"""
import json
from hashlib import sha256

from fastapi import HTTPException
from botocore.exceptions import BotoCoreError, ClientError

from app.core import storage
from app.core.contracts.directing.scene_video import SceneVideoPreparation, SceneVideoSubmitRequest, SceneVideoSaveResult
from app.core.contracts.generation import GenerationSubmitRequest, VideoGenerationOperationInput, GenerationCommand, GenerationDelivery, GenerationModality, GenerationOperation, GenerationTarget, GenerationTargetKind
from app.models.task import Task
from app.models.studio_prompts_files_timeline import FileItem
from app.models.llm import ModelCategoryKey
from app.services.llm.resolver import get_model_by_category
from app.core.contracts.directing.instruction_basis import InstructionInputs
from app.core.contracts.directing.scene_version import SceneVersionContent, EditableGenerationUnit
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.media_execution import load_media_context
from app.services.generation.submission.submitter import GenerationSubmitter
from app.services.directing.instruction_check import InstructionCheckService
from app.services.directing.store import RevisionConflict


class SceneVideoService(InstructionCheckService):
    """从已保存的原对象读取输入，不能由另一个单元或前端正文替代。"""

    async def prepare_video(self, sequence_id, version_id, unit_id, body):
        """核验保存修订、真实检查、相关依据和供应商能力，不写入或提交任务。"""
        sequence, version = await self._version(sequence_id, version_id)
        if version.revision != body.expected_revision:
            raise RevisionConflict('保存修订已变化，请重新核对当前内容后生成')
        unit = self._instruction_unit(version.content, unit_id)
        await self.require_scene_dependencies(sequence_id, version_id, unit, version.content)
        inputs, _ = await self._inputs(sequence, version_id, unit_id, version.content)
        if inputs.scope and inputs.scope.unresolved:
            raise ValueError('单元适用范围待核对：' + '；'.join(inputs.scope.unresolved))
        if not unit.instruction_check_task_id:
            raise RevisionConflict('请先完成并明确核对当前指令检查结果')
        compared = await self.compare_check(sequence_id, version_id, unit_id, unit.instruction_check_task_id, version.content)
        if not compared.confirmed:
            raise RevisionConflict('当前正文或依据与已确认检查不一致，请更新并重新检查')
        if len(''.join(unit.instruction.split())) > 5000:
            raise ValueError('指令超过 5000 非空白字符，请明确简化后重新检查')
        media = await self._prepared(sequence_id, unit, text=unit.instruction)
        request = GenerationSubmitRequest(model_id=unit.model_id, execution_prompt=unit.instruction, media=media,
            operation_input=VideoGenerationOperationInput(ratio=unit.ratio, seconds=unit.duration_ms // 1000, seed=unit.parameters.get('seed')))
        return SceneVideoPreparation(version_id=version_id, unit_id=unit_id, revision=version.revision,
            check_task_id=unit.instruction_check_task_id, inputs=inputs, request=request)

    async def submit_video(self, sequence_id, version_id, unit_id, body, *, request_hash=None):
        """原请求只读核实包括历史场次；新提交仍须当前场次并重新预检。"""
        await self.read_scene_version(sequence_id, version_id)
        request_hash = request_hash or self._video_request_hash(body)
        existing = await self.find_scene_video_request(version_id, unit_id, body.request_id)
        if existing:
            if existing.request_hash != request_hash:
                raise RevisionConflict('视频请求身份已用于另一份保存修订')
            return await self.db.get(Task, existing.task_id)
        await self._version(sequence_id, version_id)
        if await self.active_scene_video(version_id, unit_id):
            raise RevisionConflict('本单元已有视频任务，请先核实或等待取消完成')
        preparation = await self.prepare_video(sequence_id, version_id, unit_id, body)
        if body.expected_preparation is not None:
            expected = body.expected_preparation
            same_identity = ((expected.version_id, expected.unit_id, expected.check_task_id)
                             == (preparation.version_id, preparation.unit_id, preparation.check_task_id))
            if not (same_identity and expected.request == preparation.request
                    and expected.inputs.same_consumption(preparation.inputs)):
                raise RevisionConflict('本单元输入或检查已变化，请重新预检后明确提交')
        return await self._submit_video_execution(sequence_id, preparation, body.request_id, request_hash)

    async def _submit_video_execution(self, sequence_id, preparation, request_id, request_hash, *, retry_of_task_id=None):
        """当前生成与原输入重试共用不可变记录、统一门禁和任务来源关联。"""
        record = await self.create_scene_video_execution(sequence_id, preparation, request_id, request_hash)
        command = GenerationCommand(modality=GenerationModality.video, operation=GenerationOperation.video_generation,
            delivery=GenerationDelivery.async_polling, target=GenerationTarget(kind=GenerationTargetKind.scene_video, entity_id=record.id),
            request=preparation.request)
        accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(self.db, command, retry_of_task_id=retry_of_task_id)
        await self.bind_scene_video_task(record.id, accepted.task_id)
        return await self.db.get(Task, accepted.task_id)

    @staticmethod
    def _video_request_hash(body):
        """同一次授权必须保持完整输入，包括保存请求身份及其他已授权编辑。"""
        payload = body.model_dump(mode='json')
        # 未使用预检绑定的既有授权保持原哈希，升级后仍可核实原请求。
        if payload.get('expected_preparation') is None:
            payload.pop('expected_preparation', None)
        return sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

    async def save_and_submit_video(self, sequence_id, version_id, unit_id, body):
        """既有授权只读核实；新授权先保存再提交，业务预检失败保留保存。"""
        await self.read_scene_version(sequence_id, version_id)
        request_hash = self._video_request_hash(body)
        existing = await self.find_scene_video_request(version_id, unit_id, body.request_id)
        if existing:
            if existing.request_hash != request_hash:
                raise RevisionConflict('视频请求身份已用于另一份保存内容')
            return SceneVideoSaveResult(version=await self.read_scene_version(sequence_id, version_id), task_id=existing.task_id, error=None)
        await self._version(sequence_id, version_id)
        saved = await self.save_scene_version(sequence_id, version_id, body.save)
        try:
            # 保存位于外层事务。执行失败仅回滚预检之后的执行／任务写入。
            async with self.db.begin_nested():
                task = await self.submit_video(sequence_id, version_id, unit_id,
                    SceneVideoSubmitRequest(request_id=body.request_id, expected_revision=saved.revision), request_hash=request_hash)
        except (ValueError, HTTPException) as error:
            message = str(error.detail) if isinstance(error, HTTPException) else str(error)
            return SceneVideoSaveResult(version=saved, task_id=None, error=message)
        return SceneVideoSaveResult(version=saved, task_id=task.id, error=None)


    async def retry_video(self, sequence_id, version_id, unit_id, execution_id, body):
        """仅失败／取消记录可按固定输入重试；当前编辑不参与执行也不被保存。"""
        await self.read_scene_version(sequence_id, version_id)
        original, _ = await self.scene_video_execution(execution_id)
        if original.version_id != version_id or original.unit_id != unit_id:
            raise ValueError('原视频执行不属于此版本和单元')
        request_hash = sha256(f'retry:{execution_id}:{body.request_id}'.encode()).hexdigest()
        existing = await self.find_scene_video_request(version_id, unit_id, body.request_id)
        if existing:
            if existing.request_hash != request_hash:
                raise RevisionConflict('重试请求身份已用于另一份授权')
            return await self.db.get(Task, existing.task_id)
        sequence, version = await self._version(sequence_id, version_id)
        if not any(unit.id == unit_id for unit in version.content.units):
            raise RevisionConflict('原单元已不可用，不能重试或选择替代单元')
        source_task = await self.db.get(Task, original.task_id)
        if source_task.status not in {'failed', 'cancelled'}:
            raise RevisionConflict('只有失败或明确取消的视频记录可以按原依据重试')
        if await self.active_scene_video(version_id, unit_id):
            raise RevisionConflict('本单元已有视频任务，请先核实或等待取消完成')
        preparation = SceneVideoPreparation.model_validate(original.preparation)
        # 使用原绑定定位失效素材，当前编辑中的替代参考不能参与这次重试。
        for reference in preparation.inputs.unit.references:
            file = await self.db.get(FileItem, reference.file_id)
            if file is None or file.deleted_at is not None or file.delete_requested_at is not None:
                raise ValueError(f'原参考 {reference.id}（文件 {reference.file_id}）不可用，请核对原执行的固定输入；不能自动改用当前参考')
            try:
                info = await storage.get_file_info(key=file.storage_key)
            except (BotoCoreError, ClientError, RuntimeError) as error:
                raise ValueError(f'原参考 {reference.id}（文件 {reference.file_id}）存储对象未能核实，请恢复文件或存储连接后重试；未创建任务') from error
            if not info.size:
                raise ValueError(f'原参考 {reference.id}（文件 {reference.file_id}）存储对象为空，不能按原依据重试')
        await load_media_context(self.db, source_task)
        check = await self.confirmable_instruction_check(sequence_id, version_id, unit_id, preparation.check_task_id)
        checked = check.input_snapshot['run_args']
        if (checked['instruction'] != preparation.request.execution_prompt
                or not InstructionInputs.model_validate(checked['inputs']).same_consumption(preparation.inputs)):
            raise RevisionConflict('原视频输入与检查依据不一致，不能按原记录重试')
        unit = EditableGenerationUnit(**preparation.inputs.unit.model_dump(), instruction=preparation.request.execution_prompt)
        content = SceneVersionContent(basis=preparation.inputs.basis, design=preparation.inputs.design, units=[unit])
        inputs, _ = await self._inputs(sequence, version_id, unit_id, content)
        media = await self._prepared(sequence_id, unit, text=unit.instruction)
        model = await get_model_by_category(self.db, ModelCategoryKey.video, model_or_id=unit.model_id)
        if not inputs.same_consumption(preparation.inputs) or media != preparation.request.media or model.provider_id != source_task.provider_id:
            raise RevisionConflict('原参考、模型或执行依据已不可用，不能改用当前替代输入')
        return await self._submit_video_execution(sequence_id, preparation, body.request_id, request_hash, retry_of_task_id=source_task.id)
