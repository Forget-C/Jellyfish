"""Keep draft previews authoritative until first save without creating a canvas."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.canvas_edit_approval import CanvasEditApprovalExecution, CanvasEditApprovalSnapshot
from app.schemas.canvas_assistant import CanvasAssistantExchange
from app.schemas.canvas_assistant_edit import CanvasAssistantProposal
from app.schemas.generation_canvas import CanvasDocument
from app.services.approval import ApprovalDecisionView, ApprovalError, ApprovalRequestView, ApprovalService, ApprovalSubmission
from app.services.generation_canvas.approval_upgrade import expired_approval
from app.services.generation_canvas.approved_edits import OBJECT_TYPE, CanvasEditApprovals, CanvasEditExecutionReceipt
from app.services.generation_canvas.edits import CanvasEditGroupReceipt, CanvasEditPreview, project_canvas_edit_group
from app.services.generation_canvas.lifecycle import free_canvas_lifecycle
from app.services.generation_canvas.store import CanvasStore
from app.services.task_service import utcnow


def _draft_key(source_id: str) -> str:
    return 'draft:' + source_id


def draft_approval_origin(turns: list[CanvasAssistantExchange], source_id: str) -> str:
    """Use one approval subject for revisions of the same draft preview."""
    by_id = {turn.request_id: turn for turn in turns}
    visited = set()
    while source_id in by_id and source_id not in visited:
        turn = by_id[source_id]
        if not turn.revises:
            return source_id
        visited.add(source_id)
        source_id = turn.revises
    raise expired_approval()


def _version(document: CanvasDocument, proposal: CanvasAssistantProposal, source_id: str) -> str:
    return CanvasStore.command_digest({
        'document': document.model_dump(mode='json'),
        'display': proposal.model_dump(mode='json'),
        'turn': source_id,
    })


def _access(canvas_id: str):
    from app.services.generation_canvas.assistant_versioned_approval import canvas_operator_access
    return canvas_operator_access(canvas_id)


async def stage_draft_approval(db: AsyncSession, document: CanvasDocument, source_id: str,
                               proposal: CanvasAssistantProposal, plan: CanvasEditPreview, *,
                               origin_id: str, revises: str | None = None) -> ApprovalRequestView:
    """Bind the exact displayed proposal and draft to the server-verified typed changes."""
    if (plan.canvas_id != document.id or document.project_id or not plan.groups
            or tuple(group.id for group in (proposal.groups or ())) != tuple(group.id for group in plan.groups)
            or (await free_canvas_lifecycle(db).read_free_draft(document.id)).revision >= 0):
        raise expired_approval()
    key = _draft_key(source_id)
    object_id = _draft_key(origin_id)
    body = plan.model_dump(mode='json')
    approvals = ApprovalService(db)
    access = _access(document.id)
    try:
        previous = (await approvals.read_submitted(access, object_type=OBJECT_TYPE, object_id=object_id,
                                                   idempotency_key=_draft_key(revises))) if revises else None
        if revises and previous is None:
            raise expired_approval()
        approval = await approvals.submit(access, ApprovalSubmission(
            object_type=OBJECT_TYPE, object_id=object_id, version=_version(document, proposal, source_id),
            group_ids=tuple(group.id for group in plan.groups),
            snapshot_ref='canvas-edit:' + CanvasStore.command_digest(body),
            supersedes_request_id=previous.id if previous else None,
        ), idempotency_key=key)
    except ApprovalError as error:
        raise expired_approval() from error
    if await db.get(CanvasEditApprovalSnapshot, approval.id) is None:
        db.add(CanvasEditApprovalSnapshot(request_id=approval.id, canvas_id=document.id, project_id=None,
                                          plan=body, next_scan_at=None))
        await db.flush()
    return approval


async def find_draft_approval(db: AsyncSession, document: CanvasDocument, source_id: str,
                              proposal: CanvasAssistantProposal | None, *, origin_id: str) -> ApprovalRequestView | None:
    """Browser transcript metadata locates a match; it never supplies executable changes."""
    if proposal is None:
        return None
    key = _draft_key(source_id)
    approval = await ApprovalService(db).read_submitted(
        _access(document.id), object_type=OBJECT_TYPE, object_id=_draft_key(origin_id), idempotency_key=key,
    )
    if approval and approval.version == _version(document, proposal, source_id):
        return approval
    return None


async def draft_approval_is_active(db: AsyncSession, request: ApprovalRequestView) -> bool:
    """A superseded draft may be retained as conversation history only."""
    return (await ApprovalService(db).read(_access(request.scope.id), request.id)).active


async def confirm_draft_approval(db: AsyncSession, document: CanvasDocument, request: ApprovalRequestView,
                                 group_ids: tuple[str, ...], *, request_id: str) -> CanvasDocument:
    """Project only displayed, selected changes and record consent in the caller's first-save transaction."""
    access = _access(document.id)
    plan = await CanvasEditApprovals(db).read_snapshot(access, request.id)
    selected = set(group_ids)
    if len(selected) != len(group_ids) or not selected or selected - set(request.group_ids):
        raise expired_approval()
    projected = document
    for group in plan.groups:
        if group.id not in selected:
            continue
        if set(group.depends_on) - selected:
            raise expired_approval()
        projected = project_canvas_edit_group(projected, group)
    try:
        await ApprovalService(db).decide(access, request.id, version=request.version, group_ids=group_ids,
                                         action='approve', idempotency_key='draft-save:' + request_id)
    except ApprovalError as error:
        raise expired_approval() from error
    return projected


async def promote_draft_approval(db: AsyncSession, request: ApprovalRequestView, *,
                                 canvas_revision: int, approved_group_ids: tuple[str, ...]
                                 ) -> tuple[ApprovalDecisionView | None, tuple[CanvasEditExecutionReceipt, ...]]:
    """Activate the saved-canvas request after recording the already-applied group's actual receipt."""
    snapshot = await db.get(CanvasEditApprovalSnapshot, request.id, with_for_update=True, populate_existing=True)
    if snapshot is None:
        raise expired_approval()
    decision = None
    receipts = []
    if approved_group_ids:
        decisions = await ApprovalService(db).list_decisions(_access(snapshot.canvas_id), request.id)
        decision = next((item for item in decisions if item.action == 'approve'
                         and set(item.group_ids) == set(approved_group_ids)), None)
        if decision is None:
            raise expired_approval()
        for group_id in decision.group_ids:
            group_receipt = CanvasEditGroupReceipt(group_id=group_id, state='applied')
            receipt = CanvasEditExecutionReceipt(
                request_id=request.id, decision_id=decision.id, group_id=group_id,
                state=group_receipt.state, canvas_revision=canvas_revision, result=group_receipt,
            )
            db.add(CanvasEditApprovalExecution(
                decision_id=decision.id, group_id=group_id, request_id=request.id,
                group_key=CanvasStore.command_digest({'group': group_id}), receipt=receipt.model_dump(mode='json'),
            ))
            receipts.append(receipt)
    snapshot.next_scan_at = utcnow()
    await db.flush()
    return decision, tuple(receipts)
