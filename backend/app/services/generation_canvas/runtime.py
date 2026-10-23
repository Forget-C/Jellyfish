"""画布运行边界：固定输入、原子受理、结果归属和提交有序的事件。

锁顺序：既有 Task 行 → event head；受理只创建新 Task，不锁既有 Task。
文档命令先锁 canvas，不能在 head 锁内等待 canvas 行锁。网络 I/O 不在此模块执行。
"""
import hashlib
import json
from datetime import timedelta
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.generation_canvas import (
    CanvasCurrentOutput, CanvasEvent, CanvasEventHead, CanvasPreview, CanvasResultSet,
    CanvasRun, CanvasRunNode, CanvasRunReceipt, CanvasScopeOccupancy, GenerationCanvas,
)
from app.models.llm import Model, ModelCategoryKey, Provider
from app.schemas.generation_canvas import (
    CanvasDocument, CanvasDiagnostic, CanvasNodeRead, CanvasPrecheck, CanvasPrecheckRequest,
    CanvasResolvedOutput, CanvasRunRead, CanvasRunSubmit, CanvasSnapshot, ModelCard, OutputIdentity,
)
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.compiler import compile_card
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.store import CanvasStore
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.task_service import utcnow

TERMINAL = frozenset({'succeeded', 'failed', 'cancelled', 'blocked'})


def public_parameters(value):
    """Keep credentials private, including nested model options."""
    if isinstance(value, dict):
        sensitive = {'api_key', 'api_secret', 'openai_api_key', 'authorization', 'password', 'access_token'}
        return {key: public_parameters(item) for key, item in value.items() if key.lower() not in sensitive}
    if isinstance(value, list):
        return [public_parameters(item) for item in value]
    return value


def digest(value) -> str:
    """规范化 JSON 摘要用于依据比较及原请求核实。"""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


async def event_head(db: AsyncSession, canvas_id: str) -> CanvasEventHead:
    """锁持有至调用方提交，使游标分配顺序等于可观察提交顺序。"""
    row = await db.scalar(select(CanvasEventHead).where(CanvasEventHead.canvas_id == canvas_id)
                          .with_for_update().execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(404, 'Canvas not found')
    return row


async def append_event(db, head, kind, *, node=None, run_id=None, payload=None):
    """只写数据库，提交前事件对其他连接不可见。"""
    head.cursor += 1
    envelope = {'version': 1, 'cursor': head.cursor, 'type': kind, 'canvas_id': head.canvas_id,
                'run_id': node.run_id if node else run_id, 'node_id': node.id if node else None,
                'payload': payload or {}}
    db.add(CanvasEvent(canvas_id=head.canvas_id, cursor=head.cursor, envelope=envelope))
    await db.flush()


class CanvasRuntime:
    """单卡运行是画布编排最小完整切片，沿用真实 Submitter 和 Task 生命周期。"""
    def __init__(self, db: AsyncSession, project_id: str):
        self.db, self.project_id = db, project_id

    async def _basis(self, canvas, card_id, outputs, *, lock_config=False):
        document = CanvasDocument.model_validate(canvas.document)
        card = next((card for card in document.cards if card.id == card_id), None)
        if not isinstance(card, ModelCard):
            raise HTTPException(404, 'Model card not found')
        cap = None
        model, provider, config = None, None, None
        issues = []
        category = ModelCategoryKey(card.type.removeprefix('model.'))
        if card.model_id:
            try:
                model = await self.db.get(Model, card.model_id, with_for_update=lock_config, populate_existing=True)
                if model is None or model.category != category:
                    raise HTTPException(422, 'model_unavailable')
                provider = await self.db.get(Provider, model.provider_id, with_for_update=lock_config, populate_existing=True)
                if provider is None:
                    raise HTTPException(422, 'provider_unavailable')
                config = resolve_provider_config_from_provider(provider=provider, category=category)
                cap = await model_capability(self.db, card.model_id)
            except HTTPException:
                issues.append(CanvasDiagnostic(code='MODEL_UNAVAILABLE', message='所选模型或供应商不可用', target={'card_id': card_id, 'path': ['model_id']}, blocks=['run']))
        else:
            issues.append(CanvasDiagnostic(code='MODEL_REQUIRED', message='请选择模型', target={'card_id': card_id, 'path': ['model_id']}, blocks=['run']))
        compiled = compile_card(document, card_id, model_outputs=outputs, capability=cap)
        compiled.revision = canvas.revision
        if not compiled.text.strip() and not (card.type == 'model.video' and compiled.media):
            issues.append(CanvasDiagnostic(code='TEXT_REQUIRED', message='请提供非空文本输入', target={'card_id': card_id, 'path': ['prompt']}, blocks=['run']))
        if any(not item.basis_current for item in compiled.used):
            issues.append(CanvasDiagnostic(code="INPUT_STALE", message="实际引用的模型输出依据已变，请先执行来源",
                target={"card_id": card_id}, blocks=["run"]))
        compiled.diagnostics += issues
        compiled.can_run = compiled.can_run and not issues
        public = {'card': card.model_dump(), 'input': compiled.model_dump(exclude={'revision', 'diagnostics', 'can_run'}),
                  'model': {'id': model.id, 'name': model.name, 'params': public_parameters(model.params) if category == ModelCategoryKey.text else card.config.model_dump()} if model else {}}
        frozen = None
        if config and model and provider:
            frozen = {'model_name': model.name, 'model_params': model.params or {}, 'provider_key': config.provider_key,
                      'provider_id': provider.id, 'api_key': config.api_key, 'base_url': config.base_url}
        # Display nicknames and segment IDs do not change the actual request. Inserting
        # an unused candidate may renumber tokens without invalidating a publication.
        actual = {'card_id': card.id, 'type': card.type, 'model_id': card.model_id,
                  'config': card.config.model_dump(), 'text': compiled.text,
                  'used': [item.model_dump(exclude={'token', 'basis_current'}) for item in compiled.used],
                  'media': [item.model_dump(exclude={'token', 'basis_current'}) for item in compiled.media]}
        if card.type == 'model.video':
            actual['video_media'] = compiled.video_media.model_dump()
        return compiled, public, digest({'basis': actual, 'execution': frozen}), frozen

    async def current_outputs(self, canvas) -> dict[str, list[CanvasResolvedOutput]]:
        """保留当前正式结果指向，同时递归标明依据是否仍有效。"""
        rows = list((await self.db.execute(select(CanvasCurrentOutput, CanvasResultSet).join(
            CanvasResultSet, CanvasCurrentOutput.result_set_id == CanvasResultSet.id).where(
            CanvasCurrentOutput.canvas_id == canvas.id))).all())
        stored = {pointer.card_id: result for pointer, result in rows}
        result, visiting = {}, set()
        document = CanvasDocument.model_validate(canvas.document)
        cards = {card.id: card for card in document.cards}
        async def resolve(card_id):
            if card_id in result or card_id in visiting or card_id not in stored or card_id not in cards:
                return
            visiting.add(card_id)
            for edge in document.edges:
                if edge.target_card == card_id and edge.source_card in stored:
                    await resolve(edge.source_card)
            compiled, _, fingerprint, _ = await self._basis(canvas, card_id, result)
            result[card_id] = [CanvasResolvedOutput.model_validate(item).model_copy(update={
                "basis_current": compiled.can_run and fingerprint == stored[card_id].basis_hash, "result_set_id": stored[card_id].id}) for item in stored[card_id].outputs]
            visiting.remove(card_id)
        for card_id in stored:
            await resolve(card_id)
        return result

    async def precheck(self, canvas_id: str, command: CanvasPrecheckRequest) -> CanvasPrecheck:
        """预检不占用节点，令牌绑定当前修订和实际使用依据。"""
        canvas = await CanvasStore(self.db, self.project_id).get(canvas_id)
        outputs = await self.current_outputs(canvas)
        compiled, basis, fingerprint, _ = await self._basis(canvas, command.card_id, outputs)
        token = uuid4().hex if compiled.can_run else None
        if token:
            self.db.add(CanvasPreview(token=token, canvas_id=canvas_id, card_id=command.card_id,
                revision=canvas.revision, basis_hash=fingerprint, expires_at=utcnow() + timedelta(minutes=10)))
            await self.db.flush()
        return CanvasPrecheck(revision=canvas.revision, card_id=command.card_id, execution_nodes=[command.card_id],
            reused_results=sorted({item.result_set_id for item in compiled.used if item.result_set_id}),
            input=compiled, model=basis['model'], diagnostics=compiled.diagnostics, can_run=compiled.can_run, preview_token=token)

    async def submit(self, canvas_id: str, command: CanvasRunSubmit) -> dict:
        """回执优先；范围占用、Task、固定依据和事件在同一事务受理。"""
        from app.core.contracts.generation import (GenerationCommand, GenerationTarget, GenerationSubmitRequest)
        from app.core.contracts.text_generation import TextChatInput, TextChatMessage
        from app.services.generation.gate import GenerationEntityGate
        from app.services.generation.submission.submitter import GenerationSubmitter
        canvas = await CanvasStore(self.db, self.project_id).get(canvas_id, lock=True)
        request_hash = digest(command.model_dump(exclude={'request_id'}))
        receipt = await self.db.get(CanvasRunReceipt, (canvas_id, command.request_id))
        if receipt:
            if receipt.request_hash != request_hash:
                raise diagnostic('IDEMPOTENCY_CONFLICT', '请求身份已用于其他执行', {'canvas_id': canvas_id}, status=409, blocks=['run'])
            return receipt.response
        preview = await self.db.get(CanvasPreview, command.preview_token)
        if preview is None or preview.canvas_id != canvas_id or preview.revision != canvas.revision or preview.expires_at <= utcnow():
            raise diagnostic('PREVIEW_STALE', '执行预检已过期，请重新预检', {'canvas_id': canvas_id}, status=409, blocks=['run'])
        outputs = await self.current_outputs(canvas)
        compiled, basis, fingerprint, _ = await self._basis(canvas, preview.card_id, outputs, lock_config=True)
        if not compiled.can_run or fingerprint != preview.basis_hash:
            raise diagnostic('PREVIEW_STALE', '实际输入或有效模型配置已变，请重新预检', {'card_id': preview.card_id}, status=409, blocks=['run'])
        if await self.db.get(CanvasScopeOccupancy, (canvas_id, preview.card_id)):
            raise diagnostic('RUN_SCOPE_BUSY', '模型卡仍在执行中', {'card_id': preview.card_id}, status=409, blocks=['run'])
        run = CanvasRun(id=uuid4().hex, canvas_id=canvas_id, revision=canvas.revision, scope=[preview.card_id])
        self.db.add(run)
        await self.db.flush()
        node = CanvasRunNode(id=uuid4().hex, run_id=run.id, canvas_id=canvas_id, card_id=preview.card_id,
                             basis=basis, basis_hash=fingerprint)
        self.db.add(node)
        await self.db.flush()
        self.db.add(CanvasScopeOccupancy(canvas_id=canvas_id, card_id=preview.card_id, node_id=node.id))
        card = next(card for card in CanvasDocument.model_validate(canvas.document).cards if card.id == preview.card_id)
        modality = card.type.removeprefix('model.')
        if modality == 'text':
            request = GenerationSubmitRequest(model_id=basis['model']['id'], operation_input=TextChatInput(
                messages=[TextChatMessage(role='user', content=compiled.text, sequence=1)]))
        elif modality == 'video':
            from app.core.contracts.generation import VideoGenerationOperationInput
            request = GenerationSubmitRequest(model_id=basis['model']['id'], execution_prompt=compiled.text,
                operation_input=VideoGenerationOperationInput(**card.config.model_dump()), media=compiled.video_media)
        else:
            from app.core.contracts.generation import ImageGenerationOperationInput
            from app.core.contracts.media import ImageMediaInput, MediaReference
            request = GenerationSubmitRequest(model_id=basis['model']['id'], execution_prompt=compiled.text,
                operation_input=ImageGenerationOperationInput(**card.config.model_dump()),
                media=ImageMediaInput(references=[MediaReference(file_id=item.file_id, media_kind='image', ordinal=index)
                    for index, item in enumerate(compiled.media)]))
        generation = GenerationCommand(modality=modality, operation='text_chat' if modality == 'text' else modality + '_generation',
            delivery='async_polling', target=GenerationTarget(kind='canvas_node', entity_id=node.id), request=request)
        accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(self.db, generation)
        node.task_id = accepted.task_id
        await self.db.flush()
        head = await event_head(self.db, canvas_id)
        await append_event(self.db, head, 'node.updated', node=node, payload={'node': CanvasNodeRead.model_validate(node).model_dump()})
        response = {'request_id': command.request_id, 'canvas_id': canvas_id, 'run_id': run.id, 'task_ids': [accepted.task_id]}
        self.db.add(CanvasRunReceipt(canvas_id=canvas_id, request_id=command.request_id, request_hash=request_hash, response=response))
        await self.db.flush()
        return response

    async def content(self, canvas_id: str, run_id: str, node_id: str, position: int):
        """返回一次明确另存的独立内容；文档仍通过普通 CAS 队列保存。"""
        from app.schemas.generation_canvas import CanvasContentOrigin, TextContentCard, ImageContentCard, VideoContentCard
        node = await self.output_node(canvas_id, run_id, node_id, position)
        output = node.outputs[position]
        origin = CanvasContentOrigin(canvas_id=canvas_id, run_id=run_id, node_id=node_id,
                                     position=position, incomplete=node.status != 'succeeded')
        if output['modality'] == 'text':
            return TextContentCard(id=uuid4().hex, text=output['text'], origin=origin)
        from app.services.studio.files import require_available_file
        await require_available_file(self.db, file_id=output['file_id'], expected_type=output['modality'])
        kind = ImageContentCard if output['modality'] == 'image' else VideoContentCard
        return kind(id=uuid4().hex, file_id=output['file_id'], origin=origin)

    async def output_node(self, canvas_id: str, run_id: str, node_id: str, position: int):
        """按项目和画布校验历史输出；运行中内容不伪装成固定成果。"""
        await CanvasStore(self.db, self.project_id).get(canvas_id)
        node = await self.db.scalar(select(CanvasRunNode).where(CanvasRunNode.id == node_id,
            CanvasRunNode.canvas_id == canvas_id, CanvasRunNode.run_id == run_id))
        if node is None or node.status not in TERMINAL or position < 0 or position >= len(node.outputs):
            raise diagnostic('OUTPUT_NOT_AVAILABLE', '历史成果不存在或尚未完成', {'node_id': node_id, 'position': position}, status=422)
        return node

    async def cancel(self, canvas_id: str, run_id: str, node_id: str | None = None) -> CanvasRunRead:
        """明确取消范围；先确定性锁住全部既有 Task，再触发任何事件写入。

        接收取消意图不释放占用；TaskService 的真实终态仍是唯一裁决。
        """
        from app.models.task import Task
        from app.services.task_service import TaskService
        await CanvasStore(self.db, self.project_id).get(canvas_id)
        run = await self.db.scalar(select(CanvasRun).where(CanvasRun.id == run_id, CanvasRun.canvas_id == canvas_id))
        if run is None:
            raise diagnostic('RUN_NOT_FOUND', '运行不存在', {'run_id': run_id}, status=404, blocks=['cancel'])
        nodes = list(await self.db.scalars(select(CanvasRunNode).where(CanvasRunNode.run_id == run_id)))
        targets = [node for node in nodes if node_id is None or node.id == node_id]
        if not targets:
            raise diagnostic('NODE_NOT_FOUND', '运行节点不存在', {'run_id': run_id, 'node_id': node_id}, status=404, blocks=['cancel'])
        task_ids = sorted(node.task_id for node in targets if node.task_id)
        # Do not acquire document/head locks before existing Tasks. Future DAG
        # cancellation can safely reuse this order for several running branches.
        for task_id in task_ids:
            await self.db.scalar(select(Task).where(Task.id == task_id).with_for_update().execution_options(populate_existing=True))
        for task_id in task_ids:
            await TaskService(self.db).request_cancel(task_id, reason='画布运行取消')
        await self.db.refresh(run)
        for node in nodes:
            await self.db.refresh(node)
        return CanvasRunRead(id=run.id, canvas_id=canvas_id, lifecycle=run.lifecycle,
                             nodes=[CanvasNodeRead.model_validate(node) for node in nodes])

    async def snapshot(self, canvas_id: str) -> CanvasSnapshot:
        """先锁事件头再读事实，调用方必须立即提交，不把事务留给 SSE 生命周期。"""
        head = await event_head(self.db, canvas_id)
        await CanvasStore(self.db, self.project_id).get(canvas_id)
        canvas = await self.db.get(GenerationCanvas, canvas_id, populate_existing=True)
        runs = list(await self.db.scalars(select(CanvasRun).where(CanvasRun.canvas_id == canvas_id).order_by(CanvasRun.created_at, CanvasRun.id)))
        nodes = list(await self.db.scalars(select(CanvasRunNode).where(CanvasRunNode.canvas_id == canvas_id).execution_options(populate_existing=True)))
        return CanvasSnapshot(cursor=head.cursor, runs=[CanvasRunRead(id=run.id, canvas_id=canvas_id, lifecycle=run.lifecycle,
            nodes=[CanvasNodeRead.model_validate(node) for node in nodes if node.run_id == run.id]) for run in runs],
            current_outputs=await self.current_outputs(canvas))


async def sync_task_fact(db: AsyncSession, task, *, delta: str | None = None):
    """Task 已锁定并写事实后调用；覆盖所有真实终态，不能自行提交或发网络请求。"""
    if task.target_type != 'canvas_node':
        return
    node = await db.get(CanvasRunNode, task.target_id, populate_existing=True)
    if node is None:
        return
    head = await event_head(db, node.canvas_id)
    if node.status in TERMINAL:
        return
    node.status, node.stage, node.progress = task.status, task.stage, task.progress
    if task.cancel_requested_at is not None and node.status not in TERMINAL:
        node.stage = 'cancelling'
    node.error_code, node.error_message = task.error_code, task.error_message
    if delta:
        node.text += delta
    terminal = node.status in TERMINAL
    if terminal:
        if task.result and isinstance(task.result.get('text'), str):
            node.text = task.result['text']
        if node.text:
            node.outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=node.canvas_id, card_id=node.card_id,
                port_id='text', position=0), modality='text', text=node.text).model_dump()]
        if task.kind in ('image_generation', 'video_generation'):
            from app.models.task import TaskOutput
            from app.services.studio.file_usages import upsert_file_usage
            modality = 'image' if task.kind == 'image_generation' else 'video'
            outputs = list(await db.scalars(select(TaskOutput).where(TaskOutput.task_id == task.id).order_by(TaskOutput.ordinal)))
            node.outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=node.canvas_id, card_id=node.card_id,
                port_id=modality, position=item.ordinal), modality=modality, file_id=item.file_id).model_dump() for item in outputs]
            for item in outputs:
                await upsert_file_usage(db, file_id=item.file_id, project_id=task.project_id, chapter_id=None,
                    usage_kind='canvas_history', source_ref=f'{node.canvas_id}:{node.id}:{item.ordinal}')
        if node.status == 'succeeded':
            result = CanvasResultSet(id=uuid4().hex, canvas_id=node.canvas_id, node_id=node.id, card_id=node.card_id,
                basis=node.basis, basis_hash=node.basis_hash, outputs=node.outputs)
            db.add(result)
            node.result_set_id = result.id
            node.outputs = [{**item, 'result_set_id': result.id} for item in node.outputs]
            result.outputs = node.outputs
            await db.flush()
            canvas = await db.get(GenerationCanvas, node.canvas_id, populate_existing=True)
            runtime = CanvasRuntime(db, canvas.project_id)
            try:
                compiled, _, fingerprint, _ = await runtime._basis(canvas, node.card_id, await runtime.current_outputs(canvas))
                can_publish = compiled.can_run and fingerprint == node.basis_hash
            except HTTPException:
                can_publish = False
            if can_publish:
                pointer = await db.get(CanvasCurrentOutput, (node.canvas_id, node.card_id))
                if pointer:
                    pointer.result_set_id = result.id
                else:
                    db.add(CanvasCurrentOutput(canvas_id=node.canvas_id, card_id=node.card_id, result_set_id=result.id))
                node.current_output_updated = True
        await db.execute(delete(CanvasScopeOccupancy).where(CanvasScopeOccupancy.node_id == node.id))
    await db.flush()
    payload = {'node': CanvasNodeRead.model_validate(node).model_dump()}
    if delta:
        payload.update(delta=delta, position=0)
    await append_event(db, head, 'node.finished' if terminal else 'text.delta' if delta else 'node.updated', node=node, payload=payload)
    if terminal:
        remaining = await db.scalar(select(CanvasRunNode.id).where(CanvasRunNode.run_id == node.run_id, CanvasRunNode.status.not_in(TERMINAL)).limit(1))
        if remaining is None:
            run = await db.get(CanvasRun, node.run_id)
            run.lifecycle = 'finished'
            await append_event(db, head, 'run.finished', run_id=run.id, payload={'run_id': run.id})


async def ensure_project_idle(db: AsyncSession, project_id: str) -> None:
    """Project deletion and run admission share document locks; neither locks Tasks."""
    canvases = list(await db.scalars(select(GenerationCanvas).where(GenerationCanvas.project_id == project_id)
                                    .order_by(GenerationCanvas.id).with_for_update()))
    for canvas in canvases:
        if await db.scalar(select(CanvasScopeOccupancy.node_id).where(CanvasScopeOccupancy.canvas_id == canvas.id).limit(1)):
            raise diagnostic('RUN_SCOPE_BUSY', '项目仍有活动画布运行', {'canvas_id': canvas.id}, status=409, blocks=['delete'])


async def delete_runtime(db: AsyncSession, canvas_id: str) -> None:
    """Delete only this canvas runtime after its occupancy guard, retaining unrelated data."""
    for model in (CanvasCurrentOutput, CanvasRunReceipt, CanvasPreview, CanvasScopeOccupancy,
                  CanvasResultSet, CanvasRunNode, CanvasRun, CanvasEvent, CanvasEventHead):
        await db.execute(delete(model).where(model.canvas_id == canvas_id))
