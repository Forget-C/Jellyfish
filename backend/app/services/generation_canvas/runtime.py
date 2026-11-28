"""画布运行边界：固定输入、原子受理、结果归属和提交有序的事件。

锁顺序：既有 Task 行 → event head；受理只创建新 Task，不锁既有 Task。
文档命令先锁 canvas，不能在 head 锁内等待 canvas 行锁。网络 I/O 不在此模块执行。
"""
from datetime import timedelta
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.generation_canvas import (
    CanvasCurrentOutput, CanvasEvent, CanvasEventHead, CanvasPreview, CanvasResultSet,
    CanvasRun, CanvasRunNode, CanvasRunReceipt, CanvasScopeOccupancy, GenerationCanvas,
)
from app.schemas.generation_canvas import (
    CanvasNodeRead, CanvasPrecheck, CanvasPrecheckRequest,
    CanvasRunRead, CanvasRunAccepted, CanvasRunSubmit, CanvasRuntimeEvent, CanvasSnapshot,
)
from app.services.generation_canvas.automatic_checks import automatic_check_plan
from app.services.generation_canvas.execution_basis import digest
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.store import CanvasStore
from app.services.generation_canvas.current_state import CanvasCurrentState
from app.services.task_service import TaskService, utcnow
from app.services.generation_canvas.events import event_head, append_event



def _admission_hash(generation_hash: str, checks: dict) -> str:
    return digest({'generation': generation_hash, 'automatic_checks': checks}) if checks else generation_hash


class CanvasRuntime:
    """画布受理与观察边界；范围调度沿用真实 Submitter 和 Task 生命周期。"""
    def __init__(self, db: AsyncSession, project_id: str | None):
        self.db, self.project_id = db, project_id or None

    async def precheck(self, canvas_id: str, command: CanvasPrecheckRequest) -> CanvasPrecheck:
        """预检不占用节点，令牌绑定当前修订和实际使用依据。"""
        canvas = await CanvasStore(self.db, self.project_id).get(canvas_id)
        from app.services.generation_canvas.planner import plan
        prepared = await plan(CanvasCurrentState(self.db, self.project_id), canvas, command)
        card_id = command.card_id
        automatic, estimates = await automatic_check_plan(self.db, canvas, prepared['nodes'])
        token = uuid4().hex if prepared['can_run'] else None
        if token:
            self.db.add(CanvasPreview(token=token, canvas_id=canvas_id, card_id=card_id,
                revision=canvas.revision, basis_hash=_admission_hash(prepared['basis'].basis_hash, automatic), expires_at=utcnow() + timedelta(minutes=10)))
            await self.db.flush()
        target = prepared['nodes'][card_id]
        return CanvasPrecheck(revision=canvas.revision, card_id=card_id, execution_nodes=list(prepared['nodes']),
            reused_results=prepared['reused'], input=target['compiled'], model=target['basis']['model'],
            diagnostics=prepared['diagnostics'], can_run=prepared['can_run'], preview_token=token, automatic_checks=estimates)

    async def submit(self, canvas_id: str, command: CanvasRunSubmit) -> dict:
        """同一事务固定单卡输入、创建任务并记录回执。"""
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
        prepared = await plan(CanvasCurrentState(self.db, self.project_id), canvas, CanvasPrecheckRequest(card_id=preview.card_id), lock_config=True)
        automatic, _ = await automatic_check_plan(self.db, canvas, prepared['nodes'])
        if not prepared['can_run'] or _admission_hash(prepared['basis'].basis_hash, automatic) != preview.basis_hash:
            raise diagnostic('PREVIEW_STALE', '实际输入或有效模型配置已变，请重新预检', {'card_id': preview.card_id}, status=409, blocks=['run'])
        card_id = preview.card_id
        occupancy = await self.db.get(CanvasScopeOccupancy, (canvas_id, card_id))
        if occupancy:
            occupied = await self.db.get(CanvasRunNode, occupancy.node_id)
            raise diagnostic('RUN_SCOPE_BUSY', f'卡片 {card_id} 仍由运行 {occupied.run_id} 占用，请等待真实终态后重新发起',
                {'card_id': card_id, 'run_id': occupied.run_id, 'node_id': occupied.id}, status=409, blocks=['run'])
        run = CanvasRun(id=uuid4().hex, canvas_id=canvas_id, revision=canvas.revision)
        self.db.add(run)
        await self.db.flush()
        # 创建新 Task，不取得既有 Task 锁；事件头先于文件锁。
        head = await event_head(self.db, canvas_id)
        from app.services.studio.file_usages import upsert_file_usage
        from app.services.studio.files import require_available_file
        basis = prepared['basis']
        known_files = sorted({media.file_id for media in basis.compiled.media})
        for file_id in known_files:
            await require_available_file(self.db, file_id=file_id)
        private = basis.to_snapshot()
        if card_id in automatic:
            private['automatic_checks'] = automatic[card_id]
        # 受理顺序独立于时间戳和事件保留期限。
        private['admitted_cursor'] = head.cursor + 1
        node = CanvasRunNode(id=uuid4().hex, run_id=run.id, canvas_id=canvas_id, card_id=card_id,
            status='queued', stage='queued', basis=basis.public_basis, basis_hash=basis.basis_hash,
            execution_snapshot=private)
        self.db.add(node)
        await self.db.flush()
        self.db.add(CanvasScopeOccupancy(canvas_id=canvas_id, card_id=card_id, node_id=node.id))
        for file_id in known_files:
            await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id,
                chapter_id=None, usage_kind='canvas_run', source_ref=f'{canvas_id}:{node.id}')
        await start_node(self.db, node, basis)
        await append_event(self.db, head, 'node.updated', node=node, payload={'node': CanvasNodeRead.model_validate(node).model_dump()})
        response = {'request_id': command.request_id, 'canvas_id': canvas_id, 'run_id': run.id,
                    'task_ids': [node.task_id]}
        self.db.add(CanvasRunReceipt(canvas_id=canvas_id, request_id=command.request_id, request_hash=request_hash, response=response))
        await self.db.flush()
        return response

    async def read_receipt(self, canvas_id: str, request_id: str) -> CanvasRunAccepted | None:
        """按原请求身份查受理，不需要预检凭据，不创建运行。"""
        await CanvasStore(self.db, self.project_id).get(canvas_id)
        receipt = await self.db.get(CanvasRunReceipt, (canvas_id, request_id))
        return CanvasRunAccepted.model_validate(receipt.response) if receipt else None

    async def read_task_run(self, canvas_id: str, task_id: str) -> CanvasRunRead | None:
        """按同一画布内的任务身份返回关联运行和节点事实。"""
        await CanvasStore(self.db, self.project_id).get(canvas_id)
        row = (await self.db.execute(select(CanvasRun, CanvasRunNode)
            .join(CanvasRunNode, CanvasRunNode.run_id == CanvasRun.id)
            .where(CanvasRun.canvas_id == canvas_id, CanvasRunNode.task_id == task_id)
            .execution_options(populate_existing=True))).one_or_none()
        if row is None:
            return None
        run, node = row
        return CanvasRunRead(id=run.id, canvas_id=canvas_id, lifecycle=run.lifecycle,
                             nodes=[CanvasNodeRead.model_validate(node)])

    async def read_events(self, canvas_id: str, cursor: int | None = None) -> list[CanvasRuntimeEvent]:
        """读取一批已提交事件。无法续接时返回一致快照作为新起点。"""
        head = await event_head(self.db, canvas_id)
        await CanvasStore(self.db, self.project_id).get(canvas_id)
        oldest = await self.db.scalar(select(CanvasEvent.cursor).where(CanvasEvent.canvas_id == canvas_id)
                                      .order_by(CanvasEvent.cursor).limit(1))
        earliest = oldest - 1 if oldest is not None else head.cursor
        if cursor is None or cursor < earliest or cursor > head.cursor:
            snapshot = await self.snapshot(canvas_id)
            return [CanvasRuntimeEvent(cursor=snapshot.cursor, type='snapshot', canvas_id=canvas_id,
                                       payload=snapshot.model_dump())]
        records = await self.db.scalars(select(CanvasEvent.envelope).where(
            CanvasEvent.canvas_id == canvas_id, CanvasEvent.cursor > cursor).order_by(CanvasEvent.cursor).limit(100))
        return [CanvasRuntimeEvent.model_validate(record) for record in records]

    async def cancel(self, canvas_id: str, run_id: str, node_id: str | None = None) -> CanvasRunRead:
        """明确取消范围；先确定性锁住全部既有 Task，再触发任何事件写入。

        接收取消意图不释放占用；TaskService 的真实终态仍是唯一裁决。
        """
        await CanvasStore(self.db, self.project_id).get(canvas_id)
        run = await self.db.scalar(select(CanvasRun).where(CanvasRun.id == run_id, CanvasRun.canvas_id == canvas_id))
        if run is None:
            raise diagnostic('RUN_NOT_FOUND', '运行不存在', {'run_id': run_id}, status=404, blocks=['cancel'])
        nodes = list(await self.db.scalars(select(CanvasRunNode).where(CanvasRunNode.run_id == run_id)))
        targets = [node for node in nodes if node_id is None or node.id == node_id]
        if not targets:
            raise diagnostic('NODE_NOT_FOUND', '运行节点不存在', {'run_id': run_id, 'node_id': node_id}, status=404, blocks=['cancel'])
        # TaskService 核对取消，并按 Task → 事件头的顺序结算。
        for node in targets:
            await TaskService(self.db).request_cancel(node.task_id, reason='画布运行取消')
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
        runs = list(await self.db.scalars(select(CanvasRun).where(CanvasRun.canvas_id == canvas_id)))
        nodes = list(await self.db.scalars(select(CanvasRunNode).where(CanvasRunNode.canvas_id == canvas_id).execution_options(populate_existing=True)))
        by_run = {node.run_id: node for node in nodes}
        runs.sort(key=lambda run: by_run[run.id].execution_snapshot['admitted_cursor'])
        return CanvasSnapshot(cursor=head.cursor, runs=[CanvasRunRead(id=run.id, canvas_id=canvas_id, lifecycle=run.lifecycle,
            nodes=[CanvasNodeRead.model_validate(by_run[run.id])]) for run in runs],
            current_outputs=await CanvasCurrentState(self.db, self.project_id).current_outputs(canvas))




async def active_canvas_task(db: AsyncSession, canvas_ids: list[str]) -> str | None:
    """包括生成后的检查派发与报告任务；只读状态，避免反转 Task→画布锁序。"""
    from sqlalchemy import and_, or_
    from app.models.task import Task
    from app.models.generation_canvas import CanvasCheckReport
    from app.core.contracts.task import TERMINAL_TASK_STATUSES
    if not canvas_ids:
        return None
    nodes = select(CanvasRunNode.id).where(CanvasRunNode.canvas_id.in_(canvas_ids))
    reports = select(CanvasCheckReport.id).where(CanvasCheckReport.canvas_id.in_(canvas_ids))
    results = select(CanvasResultSet.id).where(CanvasResultSet.canvas_id.in_(canvas_ids))
    return await db.scalar(select(Task.id).where(Task.status.not_in(TERMINAL_TASK_STATUSES), or_(
        and_(Task.target_type == 'canvas_node', Task.target_id.in_(nodes)),
        and_(Task.target_type == 'canvas_check_report', Task.target_id.in_(reports)),
        and_(Task.target_type == 'canvas_result_set', Task.target_id.in_(results)),
    )).limit(1))


async def ensure_project_idle(db: AsyncSession, project_id: str | None) -> None:
    """Project deletion and run admission share document locks; neither locks Tasks."""
    canvases = list(await db.scalars(select(GenerationCanvas).where(GenerationCanvas.project_id == project_id)
                                    .order_by(GenerationCanvas.id).with_for_update()))
    store = CanvasStore(db, project_id)
    for canvas in canvases:
        await store.require_idle(canvas)


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
