"""Project independent edit decisions and actual receipts into the existing conversation."""

import json
from typing import TYPE_CHECKING

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.canvas_assistant import CanvasAssistantSession, CanvasAssistantTurn
from app.schemas.canvas_assistant import CanvasAssistantExchange
from app.schemas.canvas_assistant_edit import (
    CanvasAssistantApprovalAudit, CanvasAssistantEditConflict, CanvasAssistantIndependentReview,
    CanvasAssistantProposal, CanvasAssistantProposalIssue, CanvasAssistantProposalResult,
)
from app.schemas.canvas_assistant_structure import AddCanvasCardTarget, AdjustShotMovementTarget
from app.schemas.generation_canvas import CanvasDocument, CanvasRead, CanvasSaved
from app.services.approval import ApprovalDecisionView
from app.services.generation_canvas.assistant_events import publish_events
from app.services.generation_canvas.assistant_movement import movement_basis_matches

if TYPE_CHECKING:
    from app.services.generation_canvas.approved_edits import CanvasEditExecutionReceipt


async def approval_source(db, canvas_id: str, request_id: str):
    """Locate the persisted display record for an assistant-owned request."""
    return (await db.execute(select(CanvasAssistantTurn.request_id, CanvasAssistantTurn.proposal).where(
        CanvasAssistantTurn.canvas_id == canvas_id, CanvasAssistantTurn.approval_requests['edit'].as_string() == request_id,
    ))).one_or_none()


def movement_basis_changed(proposal, group_id: str, document: CanvasDocument) -> bool:
    """Shared-source isolation must use the adopted graph as it exists at execution."""
    if not proposal:
        return False
    for group in CanvasAssistantProposal.model_validate(proposal).groups or ():
        if group.id == group_id:
            return any(isinstance(edit.target, AdjustShotMovementTarget)
                       and not movement_basis_matches(document, edit.card_id, edit.target)
                       for edit in group.edits)
    return False


async def creation_conflicts(db, canvas_id: str, executing, group_id: str, revision: int,
                             current_ids: set[str]) -> dict[str, str]:
    """Two outstanding proposals cannot independently duplicate a card the user did not ask to copy."""
    if not executing:
        return {}
    proposal = CanvasAssistantProposal.model_validate(executing.proposal)
    group = next((group for group in proposal.groups or () if group.id == group_id), None)
    creations = {edit.card_id: edit.target.card.model_dump_json() for edit in group.edits
                 if isinstance(edit.target, AddCanvasCardTarget) and not edit.copy_of} if group else set()
    if not creations:
        return {}
    rows = await db.execute(select(CanvasAssistantTurn.proposal, CanvasAssistantTurn.proposal_receipt).where(
        CanvasAssistantTurn.canvas_id == canvas_id, CanvasAssistantTurn.proposal.is_not(None),
        CanvasAssistantTurn.request_id != executing.request_id,
    ))
    applied = {}
    for raw, state in rows:
        applied_at = (state or {}).get('_applied_at') or {}
        if not raw or not applied_at:
            continue
        try:
            historical = CanvasAssistantProposal.model_validate(raw)
        except ValidationError:
            continue
        for prior in historical.groups or ():
            if prior.state != 'applied' or applied_at.get(prior.id, 0) <= revision:
                continue
            for edit in prior.edits:
                if isinstance(edit.target, AddCanvasCardTarget) and edit.card_id in current_ids:
                    applied.setdefault(edit.target.card.model_dump_json(), edit.card_id)
    return {new_id: applied[card] for new_id, card in creations.items() if card in applied}


def _proposal(turn: CanvasAssistantTurn) -> CanvasAssistantProposal:
    return CanvasAssistantProposal.model_validate(turn.proposal)


def _state(proposal):
    states = {group.state for group in proposal.groups}
    return ('pending' if 'pending' in states else 'applied' if 'applied' in states
            else 'superseded' if 'superseded' in states else 'rejected')


def _audit(turn, decision, outcome, *, groups=None, review=None, conflicts=None):
    entry = CanvasAssistantApprovalAudit(
        source_id=turn.request_id, mode='automatic' if decision.source == 'automatic' else 'manual',
        action=decision.action, outcome=outcome, group_ids=list(groups or decision.group_ids),
        review=review, decision_id=decision.id, conflicts=conflicts,
    )
    turn.approval_audit = [*(turn.approval_audit or []), entry.model_dump(mode='json')]


def record_assistant_edit_decision(db: AsyncSession, session: CanvasAssistantSession, turn: CanvasAssistantTurn,
                                   decision: ApprovalDecisionView,
                                   review: CanvasAssistantIndependentReview | None = None) -> None:
    """Journal one actual decision and project rejection without any document effect."""
    state = dict(turn.proposal_receipt or {})
    signed = state.get('_signed', {})
    if decision.id in signed:
        if review is not None and not signed[decision.id]:
            signed = {**signed, decision.id: review.model_dump(mode='json')}
            turn.proposal_receipt = {**state, '_signed': signed}
            turn.approval_audit = [{**entry, 'review': signed[decision.id]} if entry.get('decision_id') == decision.id
                                   else entry for entry in turn.approval_audit or ()]
        return
    turn.proposal_receipt = {**state, '_signed': {**signed, decision.id: review.model_dump(mode='json') if review else None}}
    if decision.action == 'reject':
        proposal = _proposal(turn)
        for group in proposal.groups:
            if group.id in decision.group_ids:
                group.state = 'rejected'
        proposal.state = _state(proposal)
        turn.proposal = proposal.model_dump(mode='json')
        _audit(turn, decision, 'rejected', review=review)
    else:
        _audit(turn, decision, 'approved', review=review)
    publish_events(db, session, CanvasAssistantExchange.model_validate(turn), 'approval.decided',
                   subject='edit', group_ids=list(decision.group_ids))


def assistant_edit_result(
    turn: CanvasAssistantTurn, decision: ApprovalDecisionView, receipts: tuple['CanvasEditExecutionReceipt', ...],
    canvas: CanvasRead | None = None,
) -> CanvasAssistantProposalResult:
    """Return the originally executed groups with current canvas and explicit conflicts."""
    proposal = _proposal(turn)
    groups = {group.id: group for group in proposal.groups}
    revisions = [receipt.canvas_revision for receipt in receipts if receipt.state in ('applied', 'no_change')]
    conflicts = []
    for receipt in receipts:
        if receipt.state != 'conflict':
            continue
        group = groups[receipt.group_id]
        for conflict in receipt.result.conflicts if receipt.result else ():
            path = conflict.difference.path
            change = next((edit for edit in group.edits if len(path) > 1 and edit.card_id == path[1]), group.edits[0])
            value = conflict.current.value
            conflicts.append(CanvasAssistantEditConflict(group_id=group.id, card_id=change.card_id, target=change.target,
                current=value if isinstance(value, str) or value is None else json.dumps(value, ensure_ascii=False)))
        if not receipt.result or not receipt.result.conflicts:
            change = group.edits[0]
            conflicts.append(CanvasAssistantEditConflict(group_id=group.id, card_id=change.card_id, target=change.target,
                current=receipt.diagnostic.message if receipt.diagnostic else '依赖的改动尚未生效'))
    saved = CanvasSaved(request_id=decision.id, canvas_id=turn.canvas_id, revision=max(revisions)) if revisions else None
    return CanvasAssistantProposalResult(proposal=proposal, receipt=saved, canvas=canvas, conflicts=conflicts)


async def publish_assistant_edit_execution(
    db: AsyncSession, project_id: str | None, canvas_id: str,
    decision: ApprovalDecisionView, receipt: 'CanvasEditExecutionReceipt',
) -> None:
    """Publish the receipt in the same commit as the execution, including Worker recovery."""
    from app.services.generation_canvas.assistant_generation import advance_waiting_assistant_generation, read_generation

    # Only the business-owned link exposes a generic approval to a conversation.
    turn = await db.scalar(select(CanvasAssistantTurn).where(
        CanvasAssistantTurn.canvas_id == canvas_id,
        CanvasAssistantTurn.approval_requests['edit'].as_string() == decision.request_id,
    ).with_for_update())
    if turn is None:
        return
    session = await db.get(CanvasAssistantSession, turn.canvas_id, with_for_update=True, populate_existing=True)
    if session is None:
        return
    record_assistant_edit_decision(db, session, turn, decision)
    proposal = _proposal(turn)
    state = dict(turn.proposal_receipt or {})
    outcome = next(group for group in proposal.groups if group.id == receipt.group_id)
    success = receipt.state in ('applied', 'no_change')
    outcome.state = 'applied' if success else 'superseded'
    proposal.state = _state(proposal)
    turn.proposal = proposal.model_dump(mode='json')
    if success:
        turn.proposal_receipt = {**state, '_applied_at': {**state.get('_applied_at', {}), outcome.id: receipt.canvas_revision}}
    else:
        issue = CanvasAssistantProposalIssue(group=int(outcome.id) if outcome.id.isdecimal() else None,
            message=receipt.diagnostic.message if receipt.diagnostic else '获批改动与当前画布冲突，请核对后重新发起。')
        turn.proposal_issues = [*(turn.proposal_issues or []), issue.model_dump(mode='json')]
    raw_review = (state.get('_signed') or {}).get(decision.id)
    review = CanvasAssistantIndependentReview.model_validate(raw_review) if raw_review else None
    signed_groups = []
    for entry in turn.approval_audit or ():
        if entry.get('decision_id') == decision.id and entry['outcome'] == 'approved':
            remaining = [group_id for group_id in entry['group_ids'] if group_id != outcome.id]
            if remaining:
                signed_groups.append({**entry, 'group_ids': remaining})
        else:
            signed_groups.append(entry)
    turn.approval_audit = signed_groups
    result = assistant_edit_result(turn, decision, (receipt,))
    _audit(turn, decision, 'applied' if success else receipt.state, groups=(outcome.id,),
           review=review, conflicts=result.conflicts or None)
    await advance_waiting_assistant_generation(db, project_id, turn.canvas_id, turn.request_id, result, [outcome.id])
    exchange = CanvasAssistantExchange.model_validate(turn)
    exchange.generation = await read_generation(db, turn.canvas_id, turn.request_id)
    publish_events(db, session, exchange, 'execution.succeeded' if success else (
        'execution.failed' if receipt.state == 'failed' else 'execution.blocked'), subject='edit', group_ids=[outcome.id])
    # The next receipt may refresh this session under lock with autoflush disabled.
    await db.flush()
