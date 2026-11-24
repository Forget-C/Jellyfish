"""消费持久化审批决定，在同一事务保存画布和执行回执。"""

from datetime import UTC, datetime, timedelta
import logging
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.canvas_edit_approval import CanvasEditApprovalExecution, CanvasEditApprovalSnapshot
from app.schemas.generation_canvas import CanvasDiagnostic
from app.services.approval import (
    ApprovalAccess, ApprovalDecisionView, ApprovalError, ApprovalRequestView, ApprovalScope,
    ApprovalService, ApprovalSubmission,
)
from app.services.generation_canvas.edits import CanvasEditGroupReceipt, CanvasEditPreview, CanvasEditReceipt, canvas_edits
from app.services.generation_canvas.errors import CanvasDomainError
from app.services.generation_canvas.store import CanvasStore

logger = logging.getLogger(__name__)
OBJECT_TYPE = 'canvas-edit'
WAIT_FOR_DECISION = timedelta(seconds=1)


class CanvasEditExecutionReceipt(BaseModel):
    """一组获批改动的业务结果，保留原决定和实际画布修订。"""

    request_id: str
    decision_id: str
    group_id: str
    state: Literal['applied', 'no_change', 'conflict', 'blocked', 'failed']
    canvas_revision: int | None = None
    result: CanvasEditGroupReceipt | None = None
    diagnostic: CanvasDiagnostic | None = None


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _scope(canvas_id: str) -> ApprovalScope:
    return ApprovalScope(kind='canvas', id=canvas_id)


def _basis_ref(plan: dict) -> str:
    return 'canvas-edit:' + CanvasStore.command_digest(plan)


def _snapshot_plan(request: ApprovalRequestView,
                   snapshot: CanvasEditApprovalSnapshot | None) -> CanvasEditPreview:
    if request.object_type != OBJECT_TYPE or snapshot is None or request.snapshot_ref != _basis_ref(snapshot.plan):
        raise ApprovalError('snapshot_not_found', '画布编辑快照不存在')
    return CanvasEditPreview.model_validate(snapshot.plan)


class CanvasEditApprovals:
    """向独立审批服务提交画布快照，并提供业务回执查询。"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.approvals = ApprovalService(db)

    async def submit(self, access: ApprovalAccess, project_id: str | None, plan: CanvasEditPreview, *,
                     object_id: str, version: str, idempotency_key: str,
                     supersedes_request_id: str | None = None) -> ApprovalRequestView:
        """在同一事务登记不可变快照和审批请求，便于 Worker 恢复。"""
        if access.scope != _scope(plan.canvas_id) or 'submit' not in access.permissions:
            raise ApprovalError('forbidden', '当前角色不可为此画布发起审批')
        await CanvasStore(self.db, project_id).get(plan.canvas_id)
        body = plan.model_dump(mode='json')
        request = await self.approvals.submit(access, ApprovalSubmission(
            object_type=OBJECT_TYPE, object_id=object_id, version=version,
            group_ids=tuple(group.id for group in plan.groups), snapshot_ref=_basis_ref(body),
            supersedes_request_id=supersedes_request_id,
        ), idempotency_key=idempotency_key)
        snapshot = await self.db.get(CanvasEditApprovalSnapshot, request.id)
        if snapshot is None:
            self.db.add(CanvasEditApprovalSnapshot(
                request_id=request.id, canvas_id=plan.canvas_id, project_id=project_id or None,
                plan=body, next_scan_at=_utcnow(),
            ))
            await self.db.flush()
        return request

    async def read_snapshot(self, access: ApprovalAccess, request_id: str) -> CanvasEditPreview:
        """通过同一资源角色查询申请当时的展示快照。"""
        request = await self.approvals.read(access, request_id)
        snapshot = await self.db.get(CanvasEditApprovalSnapshot, request.id)
        return _snapshot_plan(request, snapshot)

    async def read_receipts(self, access: ApprovalAccess, decision_id: str) -> tuple[CanvasEditExecutionReceipt, ...]:
        """按原决定分组查询执行回执，尚未执行的组没有执行回执。"""
        decision = await self.approvals.read_decision(access, decision_id)
        await self.read_snapshot(access, decision.request_id)
        rows = await self.db.scalars(select(CanvasEditApprovalExecution).where(
            CanvasEditApprovalExecution.decision_id == decision.id,
        ))
        receipts = {row.group_id: CanvasEditExecutionReceipt.model_validate(row.receipt) for row in rows}
        return tuple(receipts[group] for group in decision.group_ids if group in receipts)


async def advance_approved_canvas_edits(sessions: async_sessionmaker[AsyncSession], *, limit: int = 16) -> None:
    """每轮从到期申请中执行少量获批改动，待人工决定的申请轮流复查。"""
    now = _utcnow()
    async with sessions() as db:
        due = list(await db.execute(select(
            CanvasEditApprovalSnapshot.request_id, CanvasEditApprovalSnapshot.canvas_id,
            CanvasEditApprovalSnapshot.project_id,
        ).where(CanvasEditApprovalSnapshot.next_scan_at <= now)
         .order_by(CanvasEditApprovalSnapshot.next_scan_at, CanvasEditApprovalSnapshot.request_id).limit(limit)))
    for request_id, canvas_id, project_id in due:
        try:
            async with sessions.begin() as db:
                await _advance(db, request_id, canvas_id, project_id, now)
        except SQLAlchemyError as exc:
            logger.warning('canvas edit approval %s will retry: %s', request_id, type(exc).__name__)


async def _advance(db: AsyncSession, request_id: str, canvas_id: str, project_id: str | None, now: datetime) -> None:
    # Keep the same lock order as document saves that also update workflow state.
    try:
        await CanvasStore(db, project_id).get(canvas_id, lock=True)
        canvas_exists = True
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        canvas_exists = False
    snapshot = await db.get(CanvasEditApprovalSnapshot, request_id, with_for_update=True, populate_existing=True)
    if not snapshot or snapshot.next_scan_at is None or snapshot.next_scan_at > now:
        return
    access = ApprovalAccess(scope=_scope(canvas_id), actor_id='canvas-edit-worker', permissions={'read'}, source='service')
    approvals = ApprovalService(db)
    request = await approvals.read(access, request_id)
    plan = _snapshot_plan(request, snapshot)
    decisions = await approvals.list_decisions(access, request_id)
    handled = set((await db.execute(select(CanvasEditApprovalExecution.decision_id, CanvasEditApprovalExecution.group_id)
                                   .where(CanvasEditApprovalExecution.request_id == request_id))).all())
    approved = {group_id: decision for decision in decisions if decision.action == 'approve'
                for group_id in decision.group_ids if (decision.id, group_id) not in handled}
    waiting = [(approved[group.id], group.id) for group in plan.groups if group.id in approved]
    if waiting:
        decision, group_id = waiting[0]
        result = await _execute(db, snapshot, plan, decision, group_id, canvas_exists=canvas_exists)
        db.add(CanvasEditApprovalExecution(request_id=request_id, decision_id=decision.id, group_id=group_id,
                                           group_key=CanvasStore.command_digest({'group': group_id}),
                                           receipt=result.model_dump(mode='json')))
    if len(waiting) > 1:
        snapshot.next_scan_at = now
    elif request.active and 'pending' in request.group_states.values():
        snapshot.next_scan_at = now + WAIT_FOR_DECISION
    else:
        snapshot.next_scan_at = None


async def _execute(db: AsyncSession, snapshot: CanvasEditApprovalSnapshot, plan: CanvasEditPreview,
                   decision: ApprovalDecisionView, group_id: str, *, canvas_exists: bool) -> CanvasEditExecutionReceipt:
    identity = dict(request_id=snapshot.request_id, decision_id=decision.id, group_id=group_id)
    if not canvas_exists:
        return CanvasEditExecutionReceipt(**identity, state='failed', diagnostic=CanvasDiagnostic(
            code='CANVAS_NOT_FOUND', message='原画布已无法读取，获批改动未写入',
            target={'canvas_id': snapshot.canvas_id, 'group_id': group_id}, blocks=['save'],
        ))
    try:
        async with db.begin_nested():
            request_key = 'approved:' + CanvasStore.command_digest({'decision': decision.id, 'group': group_id})
            receipt: CanvasEditReceipt = await canvas_edits(db, snapshot.project_id).submit(
                plan, request_id=request_key, group_ids=(group_id,),
            )
    except CanvasDomainError as exc:
        return CanvasEditExecutionReceipt(**identity, state='failed', diagnostic=CanvasDiagnostic.model_validate(exc.detail))
    result, = receipt.groups
    return CanvasEditExecutionReceipt(**identity, state=result.state, canvas_revision=receipt.revision,
                                      result=result, diagnostic=result.diagnostic)
