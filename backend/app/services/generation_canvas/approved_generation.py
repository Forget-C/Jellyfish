"""按不可变依据消费获批的单卡生成，按原任务追踪实际结果。"""

from datetime import datetime, timedelta
import logging
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.canvas_generation_approval import CanvasGenerationApproval
from app.models.generation_canvas import CanvasPreview
from app.models.task import Task
from app.schemas.generation_canvas import (
    CanvasDiagnostic, CanvasPrecheck, CanvasPrecheckRequest, CanvasRunAccepted, CanvasRunRead, CanvasRunSubmit,
)
from app.services.approval import (
    ApprovalAccess, ApprovalDecisionView, ApprovalError, ApprovalRequestView, ApprovalScope, ApprovalService,
    ApprovalSubmission,
)
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.generation_inputs import canvas_generation_inputs
from app.services.generation_canvas.runs import canvas_runs
from app.services.generation_canvas.store import CanvasStore
from app.services.task_service import SUBMISSION_IN_FLIGHT, SUBMISSION_UNKNOWN, TaskService, utcnow

logger = logging.getLogger(__name__)
OBJECT_TYPE = 'canvas-generation'
_RECHECK = timedelta(seconds=1)


class CanvasGenerationExecutionReceipt(BaseModel):
    """审批、原请求受理和实际运行是三项可独立核对的事实。"""

    approval_request_id: str
    decision_id: str
    group_id: str
    generation_request_id: str | None
    state: Literal['pending', 'admitted', 'unknown', 'conflict', 'failed', 'succeeded', 'cancelled', 'rejected']
    admission: CanvasRunAccepted | None = None
    run: CanvasRunRead | None = None
    diagnostic: CanvasDiagnostic | None = None


class CanvasGenerationApprovalPreview(BaseModel):
    """服务端暂存实际检查结果和有效配置摘要，供原样送审。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    canvas_id: str
    basis_hash: str
    precheck: CanvasPrecheck

def _scope(canvas_id: str) -> ApprovalScope:
    return ApprovalScope(kind='canvas', id=canvas_id)


def _generation_request_id(decision: ApprovalDecisionView, group_id: str) -> str:
    return CanvasStore.command_digest({'approval_generation': decision.id, 'group_id': group_id})


def _snapshot_ref(basis_hash: str, preview: dict) -> str:
    return 'canvas-generation:' + CanvasStore.command_digest({'basis_hash': basis_hash, 'preview': preview})


def _displayed_inputs(preview: CanvasPrecheck) -> dict:
    data = preview.model_dump(mode='json', exclude={'revision', 'preview_token'})
    data['input'].pop('revision', None)
    return data


async def _precheck(db: AsyncSession, project_id: str | None, canvas_id: str,
                    card_id: str) -> tuple[CanvasPrecheck, CanvasPreview | None]:
    preview = await canvas_generation_inputs(db, project_id).precheck(canvas_id, CanvasPrecheckRequest(card_id=card_id))
    token = await db.get(CanvasPreview, preview.preview_token) if preview.preview_token else None
    return preview, token


def _invalid_preview(card_id: str, preview: CanvasPrecheck) -> HTTPException:
    return diagnostic('GENERATION_PRECHECK_FAILED', '当前生成输入未通过预检',
                      {'card_id': card_id, 'diagnostics': [issue.model_dump() for issue in preview.diagnostics]},
                      blocks=['run'])


class CanvasGenerationApprovals:
    """创建、读取及核对单卡生成审批，任务受理由后端独立接续。"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.approvals = ApprovalService(db)

    async def capture(self, access: ApprovalAccess, project_id: str | None, canvas_id: str,
                      card_id: str) -> CanvasGenerationApprovalPreview:
        """记录供人核对的生成依据，暂存阶段不产生审批或生成受理。"""
        if access.scope != _scope(canvas_id) or not {'read', 'submit'} & access.permissions:
            raise ApprovalError('forbidden', '当前角色不可为此画布读取生成依据')
        preview, token = await _precheck(self.db, project_id, canvas_id, card_id)
        if token is None:
            raise _invalid_preview(card_id, preview)
        result = CanvasGenerationApprovalPreview(canvas_id=canvas_id, basis_hash=token.basis_hash,
            precheck=preview.model_copy(update={'preview_token': None}))
        await self.db.delete(token)
        await self.db.flush()
        return result

    async def submit(self, access: ApprovalAccess, project_id: str | None, canvas_id: str, card_id: str, *,
                     object_id: str, version: str, idempotency_key: str, group_id: str = 'generate',
                     supersedes_request_id: str | None = None,
                     staged_preview: CanvasGenerationApprovalPreview | None = None) -> ApprovalRequestView:
        """预检可执行单卡，把展示输入与有效配置摘要固定在提案版本里。"""
        if access.scope != _scope(canvas_id) or 'submit' not in access.permissions:
            raise ApprovalError('forbidden', '当前角色不可为此画布发起生成审批')
        if staged_preview and (staged_preview.canvas_id != canvas_id or staged_preview.precheck.card_id != card_id):
            raise ApprovalError('preview_mismatch', '暂存生成预演不属于当前卡片')
        await CanvasStore(self.db, project_id).get(canvas_id, lock=True)
        previous = await self.approvals.read_submitted(access, object_type=OBJECT_TYPE, object_id=object_id,
                                                       idempotency_key=idempotency_key)
        if previous:
            entry = await self._entry(previous)
            if ((previous.version, previous.group_ids, previous.supersedes_request_id, entry.card_id)
                    != (version, (group_id,), supersedes_request_id, card_id)):
                raise ApprovalError('idempotency_conflict', '该幂等键已用于另一份生成申请')
            if staged_preview and previous.snapshot_ref != _snapshot_ref(
                staged_preview.basis_hash, staged_preview.precheck.model_dump(mode='json'),
            ):
                raise ApprovalError('idempotency_conflict', '该幂等键已用于另一份生成预演')
            return previous
        preview, token = await _precheck(self.db, project_id, canvas_id, card_id)
        if staged_preview and (token is None or staged_preview.basis_hash != token.basis_hash
                               or staged_preview.precheck.preview_token is not None
                               or _displayed_inputs(staged_preview.precheck) != _displayed_inputs(preview)):
            if token is not None:
                await self.db.delete(token)
            raise ApprovalError('preview_stale', '暂存生成依据已变化，请重新预演')
        if token is None:
            raise _invalid_preview(card_id, preview)
        shown = staged_preview.precheck if staged_preview else preview.model_copy(update={'preview_token': None})
        body = shown.model_dump(mode='json')
        request = await self.approvals.submit(access, ApprovalSubmission(
            object_type=OBJECT_TYPE, object_id=object_id, version=version, group_ids=(group_id,),
            snapshot_ref=_snapshot_ref(token.basis_hash, body), supersedes_request_id=supersedes_request_id,
        ), idempotency_key=idempotency_key)
        entry = await self.db.get(CanvasGenerationApproval, request.id)
        if entry is None:
            self.db.add(CanvasGenerationApproval(
                request_id=request.id, canvas_id=canvas_id, project_id=project_id or None, card_id=card_id,
                group_id=group_id, basis_hash=token.basis_hash, preview=body, next_scan_at=utcnow(),
            ))
        await self.db.delete(token)
        await self.db.flush()
        return request

    async def read_snapshot(self, access: ApprovalAccess, request_id: str) -> CanvasPrecheck:
        """读取用户所见的原生成依据，不泄露预检凭据或私有配置。"""
        request = await self.approvals.read(access, request_id)
        entry = await self._entry(request)
        return CanvasPrecheck.model_validate(entry.preview)

    async def _entry(self, request: ApprovalRequestView) -> CanvasGenerationApproval:
        entry = await self.db.get(CanvasGenerationApproval, request.id, populate_existing=True)
        if (entry is None or request.object_type != OBJECT_TYPE
                or request.snapshot_ref != _snapshot_ref(entry.basis_hash, entry.preview)):
            raise ApprovalError('snapshot_not_found', '画布生成快照不存在')
        return entry

    async def read_receipt(self, access: ApprovalAccess, decision_id: str) -> CanvasGenerationExecutionReceipt:
        """按原决定返回其实际运行、未知状态或失败原因；查询不会受理。"""
        decision = await self.approvals.read_decision(access, decision_id)
        request = await self.approvals.read(access, decision.request_id)
        entry = await self._entry(request)
        fields = dict(approval_request_id=request.id, decision_id=decision.id, group_id=entry.group_id)
        if decision.action == 'reject':
            return CanvasGenerationExecutionReceipt(**fields, generation_request_id=None, state='rejected')
        generation_id = _generation_request_id(decision, entry.group_id)
        state = entry.state
        accepted = CanvasRunAccepted.model_validate(entry.admission) if entry.admission else None
        if accepted is None:
            return CanvasGenerationExecutionReceipt(**fields, generation_request_id=generation_id, state=state,
                                                    diagnostic=entry.diagnostic)
        runs = canvas_runs(self.db, entry.project_id)
        try:
            run = await runs.read_task_run(entry.canvas_id, accepted.task_ids[0])
        except HTTPException as error:
            if error.status_code != 404:
                raise
            run = None
        if run and run.nodes[0].stage == SUBMISSION_UNKNOWN:
            state = 'unknown'
        elif run and run.nodes[0].status in ('succeeded', 'failed', 'cancelled'):
            state = run.nodes[0].status
        return CanvasGenerationExecutionReceipt(**fields, generation_request_id=generation_id, state=state,
                                                admission=accepted, run=run)

    async def record_provider_id(self, access: ApprovalAccess, decision_id: str, provider_task_id: str) -> None:
        """可信供应商对账方确认原任务的远端身份后，接回既有轮询。"""
        if access.source != 'service' or not provider_task_id.strip() or len(provider_task_id.strip()) > 255:
            raise ApprovalError('forbidden', '远端任务关联只接受可信对账结果')
        receipt = await self.read_receipt(access, decision_id)
        if receipt.admission is None:
            raise ApprovalError('generation_not_admitted', '原生成请求尚未受理')
        task_id = receipt.admission.task_ids[0]
        row = await self.db.get(Task, task_id, with_for_update=True, populate_existing=True)
        if row and row.execution_mode == 'remote' and row.provider_task_id == provider_task_id.strip():
            return
        if (not row or row.execution_mode != 'remote' or row.provider_task_id
                or row.stage not in (SUBMISSION_IN_FLIGHT, SUBMISSION_UNKNOWN)):
            raise ApprovalError('provider_id_conflict', '原任务无法关联此远端身份')
        await TaskService(self.db).record_submission(task_id, provider_task_id=provider_task_id)


async def advance_approved_canvas_generations(sessions: async_sessionmaker[AsyncSession], *, limit: int = 16) -> None:
    """小批次接续已存在的申请，每个已授权的原请求最多受理一次。"""
    now = utcnow()
    async with sessions() as db:
        rows = list(await db.execute(select(
            CanvasGenerationApproval.request_id, CanvasGenerationApproval.canvas_id, CanvasGenerationApproval.project_id,
        ).where(CanvasGenerationApproval.next_scan_at <= now)
         .order_by(CanvasGenerationApproval.next_scan_at, CanvasGenerationApproval.request_id).limit(limit)))
    for request_id, canvas_id, project_id in rows:
        try:
            async with sessions.begin() as db:
                await _advance(db, request_id, canvas_id, project_id, now)
        except SQLAlchemyError as error:
            logger.warning('canvas generation approval %s will retry: %s', request_id, type(error).__name__)


async def _advance(db: AsyncSession, request_id: str, canvas_id: str, project_id: str | None,
                   now: datetime) -> None:
    try:
        await CanvasStore(db, project_id).get(canvas_id, lock=True)
        exists = True
    except HTTPException as error:
        if error.status_code != 404:
            raise
        exists = False
    entry = await db.get(CanvasGenerationApproval, request_id, with_for_update=True, populate_existing=True)
    if entry is None or entry.next_scan_at is None or entry.next_scan_at > now:
        return
    access = ApprovalAccess(scope=_scope(canvas_id), actor_id='canvas-generation-worker',
                            permissions={'read'}, source='service')
    approvals = ApprovalService(db)
    request = await approvals.read(access, request_id)
    decisions = await approvals.list_decisions(access, request_id)
    if not decisions:
        entry.next_scan_at = now + _RECHECK if request.active else None
        return
    decision, = decisions
    entry.decision_id = decision.id
    entry.next_scan_at = None
    if decision.action == 'reject':
        entry.state = 'rejected'
        return
    if not exists:
        entry.state = 'failed'
        entry.diagnostic = CanvasDiagnostic(code='CANVAS_NOT_FOUND', message='原画布已无法读取',
                                            target={'canvas_id': canvas_id}, blocks=['run']).model_dump()
        return
    generation_id = _generation_request_id(decision, entry.group_id)
    runs = canvas_runs(db, project_id)
    # Recover the original admission before running a fresh precheck or touching the provider.
    admission = await runs.read_receipt(canvas_id, generation_id)
    if admission is None:
        admission = await _admit(db, entry, generation_id, now)
    if admission:
        entry.state = 'admitted'
        entry.admission = admission.model_dump(mode='json')
        entry.task_id, = admission.task_ids


async def _admit(db: AsyncSession, entry: CanvasGenerationApproval, generation_id: str,
                 now: datetime) -> CanvasRunAccepted | None:
    try:
        async with db.begin_nested():
            _, token = await _precheck(db, entry.project_id, entry.canvas_id, entry.card_id)
            if token is None or token.basis_hash != entry.basis_hash:
                raise diagnostic('GENERATION_BASIS_CHANGED', '实际生成输入已变化，请核对后重新审批',
                                 {'card_id': entry.card_id}, status=409, blocks=['run'])
            result = await canvas_runs(db, entry.project_id).submit(entry.canvas_id, CanvasRunSubmit(
                request_id=generation_id, preview_token=token.token,
            ))
            await db.delete(token)
            return result
    except HTTPException as error:
        detail = error.detail
        code = detail.get('code') if isinstance(detail, dict) else None
        if code == 'RUN_SCOPE_BUSY':
            entry.next_scan_at = now + _RECHECK
            return None
        entry.state = 'conflict' if code in ('GENERATION_BASIS_CHANGED', 'PREVIEW_STALE') else 'failed'
        entry.diagnostic = detail if code else CanvasDiagnostic(
            code='GENERATION_ADMISSION_FAILED', message='生成受理失败',
            target={'card_id': entry.card_id}, blocks=['run'],
        ).model_dump()
        return None


async def begin_approved_provider_submission(db: AsyncSession, task_id: str, *, worker_id: str) -> bool:
    """已获批生成标记真正对外发送的边界，既有运行保留原处理方式。"""
    return not await _tracks_task(db, task_id) or await TaskService(db).begin_provider_submission(
        task_id, worker_id=worker_id,
    )


async def preserve_approved_provider_submission(db: AsyncSession, task_id: str) -> bool:
    """受理写入结果不明时，先核对已登记的远端身份再保留不确定状态。"""
    if not await _tracks_task(db, task_id):
        return False
    task = await db.get(Task, task_id, with_for_update=True, populate_existing=True)
    if task is None:
        return False
    if task.provider_task_id and task.execution_mode == 'remote':
        return True
    return await TaskService(db).mark_provider_submission_unknown(task_id)


async def _tracks_task(db: AsyncSession, task_id: str) -> bool:
    return bool(await db.scalar(select(CanvasGenerationApproval.task_id).where(
        CanvasGenerationApproval.task_id == task_id,
    )))
