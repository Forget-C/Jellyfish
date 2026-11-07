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
from app.schemas.generation_canvas import (
    CanvasNodeRead, CanvasPrecheck, CanvasPrecheckRequest,
    CanvasRunRead, CanvasRunSubmit, CanvasSnapshot,
)
from app.services.generation_canvas.automatic_checks import automatic_check_plan
from app.services.generation_canvas.execution_basis import digest
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.store import CanvasStore
from app.services.generation_canvas.current_state import CanvasCurrentState
from app.services.task_service import utcnow
from app.services.generation_canvas.events import event_head, append_event



def _admission_hash(generation_hash: str, checks: dict) -> str:
    return digest({'generation': generation_hash, 'automatic_checks': checks}) if checks else generation_hash


class CanvasRuntime:
    """画布受理与观察边界；范围调度沿用真实 Submitter 和 Task 生命周期。"""
    def __init__(self, db: AsyncSession, project_id: str):
        self.db, self.project_id = db, project_id

    async def precheck(self, canvas_id: str, command: CanvasPrecheckRequest) -> CanvasPrecheck:
        """预检不占用节点，令牌绑定当前修订和实际使用依据。"""
        canvas = await CanvasStore(self.db, self.project_id).get(canvas_id)
        from app.services.generation_canvas.planner import plan
        prepared = await plan(CanvasCurrentState(self.db, self.project_id), canvas, command)
        card_id = command.card_id if command.card_id in prepared['nodes'] else next(iter(prepared['nodes']))
        automatic, estimates = await automatic_check_plan(self.db, canvas, prepared['nodes'])
        token = uuid4().hex if prepared['can_run'] else None
        if token:
            self.db.add(CanvasPreview(token=token, canvas_id=canvas_id, card_id=card_id, kind=command.kind,
                card_ids=list(prepared['nodes']) if command.kind == 'selection' else None,
                revision=canvas.revision, basis_hash=_admission_hash(prepared['hash'], automatic), expires_at=utcnow() + timedelta(minutes=10)))
            await self.db.flush()
        target = prepared['nodes'][card_id]
        return CanvasPrecheck(revision=canvas.revision, card_id=card_id, execution_nodes=list(prepared['nodes']),
            reused_results=prepared['reused'], input=target['compiled'], model=target['basis']['model'],
            diagnostics=prepared['diagnostics'], can_run=prepared['can_run'], preview_token=token, automatic_checks=estimates)

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
        prepared = await plan(CanvasCurrentState(self.db, self.project_id), canvas, CanvasPrecheckRequest(card_id=preview.card_id, kind=preview.kind, card_ids=preview.card_ids or []), lock_config=True)
        automatic, _ = await automatic_check_plan(self.db, canvas, prepared['nodes'])
        if not prepared['can_run'] or _admission_hash(prepared['hash'], automatic) != preview.basis_hash:
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
            if card_id in automatic:
                private['automatic_checks'] = automatic[card_id]
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
            current_outputs=await CanvasCurrentState(self.db, self.project_id).current_outputs(canvas))




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
