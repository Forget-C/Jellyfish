"""画布运行边界：固定输入、原子受理、结果归属和提交有序的事件。

锁顺序：既有 Task 行 → event head；受理只创建新 Task，不锁既有 Task。
文档命令先锁 canvas，不能在 head 锁内等待 canvas 行锁。网络 I/O 不在此模块执行。
"""
from datetime import timedelta
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.generation_canvas import (
    CanvasCurrentOutput, CanvasEvent, CanvasEventHead, CanvasPreview, CanvasResultSet,
    CanvasRun, CanvasRunNode, CanvasRunReceipt, CanvasScopeOccupancy, GenerationCanvas,
)
from app.models.llm import Model, ModelCategoryKey, Provider
from app.schemas.generation_canvas import (
    CanvasDocument, CanvasDiagnostic, CanvasNodeRead, CanvasPrecheck, CanvasPrecheckRequest,
    CanvasResolvedOutput, CanvasRunRead, CanvasRunSubmit, CanvasSnapshot, MediaContentCard, ModelCard, OutputIdentity,
)
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.generation_canvas.execution_basis import CanvasModelContext, build_basis, digest
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.store import CanvasStore
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.task_service import utcnow

TERMINAL = frozenset({'succeeded', 'failed', 'cancelled', 'blocked'})


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
    """画布受理与观察边界；范围调度沿用真实 Submitter 和 Task 生命周期。"""
    def __init__(self, db: AsyncSession, project_id: str):
        self.db, self.project_id = db, project_id

    async def _current_basis(self, canvas, card_id, outputs, *, lock_config=False, context=None):
        """读取当前配置及原有锁，再交给纯依据模块；已受理恢复不经过此入口。"""
        context = context or CanvasOutputContext(CanvasDocument.model_validate(canvas.document))
        document = context.document
        card = context.cards.get(card_id)
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
        frozen = None
        if config and model and provider:
            frozen = {'model_name': model.name, 'model_params': model.params or {}, 'provider_key': config.provider_key,
                      'provider_id': provider.id, 'api_key': config.api_key, 'base_url': config.base_url}
        model_context = CanvasModelContext(
            model={'id': model.id, 'name': model.name, 'params': model.params} if model else None,
            execution_config=frozen, capability=cap, diagnostics=issues)
        return build_basis(document, card_id, outputs, revision=canvas.revision, model_context=model_context, context=context)

    async def current_outputs(self, canvas, *, context=None) -> dict[str, list[CanvasResolvedOutput]]:
        """保留当前正式结果指向，同时递归标明依据是否仍有效。"""
        rows = list((await self.db.execute(select(CanvasCurrentOutput, CanvasResultSet).join(
            CanvasResultSet, CanvasCurrentOutput.result_set_id == CanvasResultSet.id).where(
            CanvasCurrentOutput.canvas_id == canvas.id))).all())
        stored = {pointer.card_id: result for pointer, result in rows}
        result, visiting = {}, set()
        context = context or CanvasOutputContext(CanvasDocument.model_validate(canvas.document))
        document = context.document
        cards = context.cards
        # 文件可在保存后失效；读取和编译统一使用已核验的媒体出口。
        from app.services.generation_canvas.outputs import card_outputs
        from app.services.studio.files import require_available_file
        from app.models.studio import FileUsage
        from app.schemas.generation_canvas import NamedImageReferenceCard
        for card in document.cards:
            named = isinstance(card, NamedImageReferenceCard)
            file_id = card.image_binding.file_id if named and card.image_binding else card.file_id if isinstance(card, MediaContentCard) else None
            if not file_id:
                continue
            outputs = card_outputs(canvas.id, card)
            try:
                await require_available_file(self.db, file_id=file_id,
                    expected_type=card.output_ports[0], lock=False)
                belongs = await self.db.scalar(select(FileUsage.id).where(
                    FileUsage.file_id == file_id, FileUsage.project_id == self.project_id).limit(1))
                if not belongs:
                    raise HTTPException(404, 'File not in project')
            except HTTPException:
                outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas.id, card_id=card.id,
                    port_id=card.output_ports[0], position=0), modality=card.output_ports[0], available=False)]
                result[card.id] = outputs
            else:
                if not named:
                    result[card.id] = outputs
        async def resolve(card_id):
            if card_id in result or card_id in visiting or card_id not in stored or card_id not in cards:
                return
            visiting.add(card_id)
            for edge in context.incoming.get(card_id, ()):
                if edge.source_card in stored:
                    await resolve(edge.source_card)
            from app.services.generation_canvas.design_references import effective_design_references
            from app.services.generation_canvas.output_resolution import prompt_references
            for reference, _ in prompt_references(cards[card_id]):
                design = cards.get(reference.source.card_id)
                if design:
                    designs = [design, *(cards[binding.source.card_id] for binding in getattr(design, 'input_bindings', [])
                        if binding.input_port == 'acceptance_basis' and binding.source.card_id in cards)]
                    for selected in designs:
                        for field_ref, _, _ in effective_design_references(selected, cards):
                            if field_ref.source.canvas_id == document.id and field_ref.source.card_id in stored:
                                await resolve(field_ref.source.card_id)
            basis = await self._current_basis(canvas, card_id, result, context=context)
            result[card_id] = [CanvasResolvedOutput.model_validate(item).model_copy(update={
                "basis_current": basis.compiled.can_run and basis.basis_hash == stored[card_id].basis_hash, "result_set_id": stored[card_id].id}) for item in stored[card_id].outputs]
            # 正式位置保留身份，但文件撤回后不能继续作为可用输入，也不以重跑承诺放行。
            for index, output in enumerate(result[card_id]):
                if not output.file_id:
                    continue
                try:
                    await require_available_file(self.db, file_id=output.file_id,
                        expected_type=output.modality, lock=False)
                except HTTPException:
                    result[card_id][index] = CanvasResolvedOutput(source=output.source,
                        modality=output.modality, available=False, result_set_id=output.result_set_id,
                        basis_current=output.basis_current)
            visiting.remove(card_id)
        for card_id in stored:
            await resolve(card_id)
        return result

    async def precheck(self, canvas_id: str, command: CanvasPrecheckRequest) -> CanvasPrecheck:
        """预检不占用节点，令牌绑定当前修订和实际使用依据。"""
        canvas = await CanvasStore(self.db, self.project_id).get(canvas_id)
        from app.services.generation_canvas.planner import plan
        prepared = await plan(self, canvas, command)
        card_id = command.card_id if command.card_id in prepared['nodes'] else next(iter(prepared['nodes']))
        token = uuid4().hex if prepared['can_run'] else None
        if token:
            self.db.add(CanvasPreview(token=token, canvas_id=canvas_id, card_id=card_id, kind=command.kind,
                card_ids=list(prepared['nodes']) if command.kind == 'selection' else None,
                revision=canvas.revision, basis_hash=prepared['hash'], expires_at=utcnow() + timedelta(minutes=10)))
            await self.db.flush()
        target = prepared['nodes'][card_id]
        return CanvasPrecheck(revision=canvas.revision, card_id=card_id, execution_nodes=list(prepared['nodes']),
            reused_results=prepared['reused'], input=target['compiled'], model=target['basis']['model'],
            diagnostics=prepared['diagnostics'], can_run=prepared['can_run'], preview_token=token)

    async def submit(self, canvas_id: str, command: CanvasRunSubmit) -> dict:
        """原子固定全部节点；等待输入只能来自本轮固定生产者。"""
        from app.services.generation_canvas.planner import plan, start_node
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
        prepared = await plan(self, canvas, CanvasPrecheckRequest(card_id=preview.card_id, kind=preview.kind, card_ids=preview.card_ids or []), lock_config=True)
        if not prepared['can_run'] or prepared['hash'] != preview.basis_hash:
            raise diagnostic('PREVIEW_STALE', '实际输入或有效模型配置已变，请重新预检', {'card_id': preview.card_id}, status=409, blocks=['run'])
        for card_id in prepared['nodes']:
            occupancy = await self.db.get(CanvasScopeOccupancy, (canvas_id, card_id))
            if occupancy:
                occupied = await self.db.get(CanvasRunNode, occupancy.node_id)
                raise diagnostic('RUN_SCOPE_BUSY', f'卡片 {card_id} 仍由运行 {occupied.run_id} 占用，请等待真实终态后重新发起',
                    {'card_id': card_id, 'run_id': occupied.run_id, 'node_id': occupied.id}, status=409, blocks=['run'])
        run = CanvasRun(id=uuid4().hex, canvas_id=canvas_id, revision=canvas.revision, scope=list(prepared['nodes']))
        self.db.add(run)
        await self.db.flush()
        # Both admission and terminal scheduling acquire head before concrete
        # input file locks. Existing Tasks are never acquired by admission.
        head = await event_head(self.db, canvas_id)
        nodes = []
        from app.services.studio.file_usages import upsert_file_usage
        from app.services.studio.files import require_available_file
        known_files = sorted({media.file_id for item in prepared['nodes'].values() for media in item['compiled'].media})
        for file_id in known_files:
            await require_available_file(self.db, file_id=file_id)
        for card_id, item in prepared['nodes'].items():
            private = item['private']
            private['dependencies'] = item['dependencies']
            # Private admission order survives timestamp ties and event-log pruning.
            private['admitted_cursor'] = head.cursor + 1
            node = CanvasRunNode(id=uuid4().hex, run_id=run.id, canvas_id=canvas_id, card_id=card_id,
                status='waiting', stage='waiting', basis=item['basis'], basis_hash=item['hash'], execution_snapshot=private)
            self.db.add(node)
            await self.db.flush()
            self.db.add(CanvasScopeOccupancy(canvas_id=canvas_id, card_id=card_id, node_id=node.id))
            # Protect every concrete known input at admission, before a downstream Task exists.
            for media in item['compiled'].media:
                await upsert_file_usage(self.db, file_id=media.file_id, project_id=self.project_id,
                    chapter_id=None, usage_kind='canvas_run', source_ref=f'{canvas_id}:{node.id}')
            nodes.append(node)
        for node in nodes:
            if not node.execution_snapshot['dependencies']:
                await start_node(self.db, node)
        for node in nodes:
            await append_event(self.db, head, 'node.updated', node=node, payload={'node': CanvasNodeRead.model_validate(node).model_dump()})
        response = {'request_id': command.request_id, 'canvas_id': canvas_id, 'run_id': run.id,
                    'task_ids': [node.task_id for node in nodes if node.task_id]}
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
        # Lock the entire run in frozen topological scope order, including ancestors
        # of a waiting single-node cancel. A producer lock makes its later child
        # identity stable before that child's turn; no Task can appear behind the
        # cancellation scan. Every cancellation uses this same order.
        by_card = {node.card_id: node for node in nodes}
        for card_id in run.scope:
            node = by_card[card_id]
            await self.db.refresh(node)
            if node.task_id:
                await self.db.scalar(select(Task).where(Task.id == node.task_id).with_for_update().execution_options(populate_existing=True))
        task_ids = [node.task_id for node in targets if node.task_id]
        head = await event_head(self.db, canvas_id)
        from app.services.generation_canvas.planner import stop_waiting, advance
        for node in targets:
            if node.status == 'waiting':
                await stop_waiting(self.db, node, head, 'blocked' if node_id is None else 'cancelled', 'RUN_CANCELLED', '画布运行取消')
        if node_id is None:
            for node in nodes:
                if node.status == 'waiting':
                    await stop_waiting(self.db, node, head, 'blocked', 'RUN_CANCELLED', '画布运行取消')
        for task_id in task_ids:
            await TaskService(self.db).request_cancel(task_id, reason='画布运行取消')
        await advance(self.db, run_id, head)
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
        admission = {node.run_id: node.execution_snapshot['admitted_cursor'] for node in nodes
                     if node.execution_snapshot and 'admitted_cursor' in node.execution_snapshot}
        if len(admission) < len(runs):
            # Legacy runs can recover their order from retained events; fully pruned legacy
            # history has only the old timestamp/ID fallback and precedes known admissions.
            legacy_ids = [run.id for run in runs if run.id not in admission]
            event_run = CanvasEvent.envelope['run_id'].as_string()
            events = await self.db.execute(select(event_run, func.min(CanvasEvent.cursor)).where(
                CanvasEvent.canvas_id == canvas_id, event_run.in_(legacy_ids)).group_by(event_run))
            admission.update(events.all())
        runs.sort(key=lambda run: (admission.get(run.id, 0), run.created_at, run.id))
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
                context = CanvasOutputContext(CanvasDocument.model_validate(canvas.document))
                basis = await runtime._current_basis(canvas, node.card_id,
                    await runtime.current_outputs(canvas, context=context), context=context)
                can_publish = basis.compiled.can_run and basis.basis_hash == node.basis_hash
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
    if terminal and node.current_output_updated:
        # Publication also changes downstream validity; the shared stream must
        # carry that authoritative view without executing those downstream cards.
        payload['current_outputs'] = {key: [item.model_dump() for item in values]
            for key, values in (await runtime.current_outputs(canvas)).items()}
    if delta:
        payload.update(delta=delta, position=0)
    await append_event(db, head, 'node.finished' if terminal else 'text.delta' if delta else 'node.updated', node=node, payload=payload)
    if terminal:
        from app.services.generation_canvas.planner import advance
        await advance(db, node.run_id, head, interrupted=task.error_code in ('execution_interrupted', 'submission_interrupted'))


async def ensure_project_idle(db: AsyncSession, project_id: str) -> None:
    """Project deletion and run admission share document locks; neither locks Tasks."""
    canvases = list(await db.scalars(select(GenerationCanvas).where(GenerationCanvas.project_id == project_id)
                                    .order_by(GenerationCanvas.id).with_for_update()))
    for canvas in canvases:
        if await db.scalar(select(CanvasScopeOccupancy.node_id).where(CanvasScopeOccupancy.canvas_id == canvas.id).limit(1)):
            raise diagnostic('RUN_SCOPE_BUSY', '项目仍有活动画布运行', {'canvas_id': canvas.id}, status=409, blocks=['delete'])


async def delete_runtime(db: AsyncSession, canvas_id: str) -> None:
    """Delete only this canvas runtime after its occupancy guard, retaining unrelated data."""
    from app.models.studio import FileUsage
    canvas = await db.get(GenerationCanvas, canvas_id)
    if canvas is not None:
        await db.execute(delete(FileUsage).where(
            FileUsage.project_id == canvas.project_id, FileUsage.usage_kind.in_(['canvas_run', 'canvas_history']),
            FileUsage.source_ref.like(f'{canvas_id}:%')))
    for model in (CanvasCurrentOutput, CanvasRunReceipt, CanvasPreview, CanvasScopeOccupancy,
                  CanvasResultSet, CanvasRunNode, CanvasRun, CanvasEvent, CanvasEventHead):
        await db.execute(delete(model).where(model.canvas_id == canvas_id))
