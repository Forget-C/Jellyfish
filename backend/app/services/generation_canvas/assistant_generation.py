"""Admit only the versions authorized in the current user's own message."""

import re
from hashlib import sha256

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.canvas_assistant import CanvasAssistantGeneration, CanvasAssistantSession, CanvasAssistantTurn
from app.models.generation_canvas import CanvasRun, CanvasRunNode, CanvasRunReceipt, GenerationCanvas
from app.schemas.canvas_assistant_edit import CanvasAssistantProposalResult
from app.schemas.canvas_assistant_generation import (CanvasAssistantGenerationApproval, CanvasAssistantGenerationRead, CanvasAssistantGenerationReview,
                                                       CanvasAssistantGenerationVersion)
from app.schemas.generation_canvas import CanvasDocument
from app.schemas.canvas_assistant import CanvasAssistantExchange
from app.services.generation_canvas.approval_upgrade import legacy_generation_request_id as _request_id, require_unexpired_approval
from app.services.generation_canvas.assistant_events import publish_events
from app.services.generation_canvas.assistant_generation_approvals import (
    generation_status, reconcile_generation, stage_generation,
)
from app.services.generation_canvas.assistant_targets import explicit_generation_quantity, shot_request_matches
from app.services.generation_canvas.store import CanvasStore
from app.services.task_service import SUBMISSION_UNKNOWN, utcnow


def _presentation_guidance(text: str) -> bool:
    """Recognize delivery-only instructions that leave the authorized generation unchanged."""
    return re.fullmatch(r'(?:请)?(?:用(?:中文|英文)回复|(?:把)?回复(?:写得)?(?:简单|简短|精简)一点)[。！.!]?', text.strip()) is not None


def generation_authorization(turn: CanvasAssistantTurn, document: CanvasDocument,
                             revision: int) -> CanvasAssistantGeneration | None:
    """Freeze the selected model card and quantity without interpreting model output as permission."""
    authority = explicit_generation_quantity(turn.text)
    context = turn.context
    if authority is None or turn.revises or not context or context['scope'] != 'selection':
        return None
    count, waits_for_edit, review = authority
    target_ids = set(context['target_card_ids'])
    model_cards = [card for card in document.cards if card.id in target_ids and card.type.startswith('model.')
                   and shot_request_matches(turn.text, document, card.id)]
    if len(model_cards) != 1:
        return None
    card_id = model_cards[0].id
    state, error = ('waiting_approval', None) if waits_for_edit else ('queued', None)
    if waits_for_edit and not turn.proposal:
        state, error = 'failed', '未获得可审批的修改建议，因此未生成'
    if not waits_for_edit:
        saved = {item.id: item.model_dump(mode='json') for item in document.cards}
        if context['revision'] != revision or any(saved.get(item['id']) != item for item in context['cards']):
            state, error = 'failed', '画布输入存在未保存的改动，请保存并重新明确授权生成'
    if turn.instructions and not all(_presentation_guidance(item['text']) for item in turn.instructions):
        state, error = 'stopped', '补充指令改变了本轮依据，请核对后重新明确生成数量'
    return CanvasAssistantGeneration(canvas_id=turn.canvas_id, source_id=turn.request_id, card_id=card_id,
        requested_count=count, state=state, expected_revision=revision, error=error, created_at=utcnow(),
        review_request=review, review_state='waiting' if review else None)


async def update_generation_for_decision(db: AsyncSession, canvas_id: str, source_id: str,
                                         proposal_state: str, revision: int | None = None,
                                         *, result: CanvasAssistantProposalResult | None = None,
                                         group_ids: list[str] | None = None) -> None:
    """Update a waiting authorization in the same transaction as the edit decision."""
    entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id), with_for_update=True)
    if entry is None or entry.state != 'waiting_approval':
        return
    if result is not None:
        proposal = result.proposal
        turn = await db.get(CanvasAssistantTurn, (canvas_id, source_id))
        input_cards = {entry.card_id, *(card['id'] for card in turn.context['cards'])}
        if proposal.groups:
            relevant = [group for group in proposal.groups if any(edit.card_id in input_cards for edit in group.edits)]
            if revision is not None and group_ids and any(group.id in group_ids and group.state == 'applied'
                                                         for group in relevant):
                entry.expected_revision = max(entry.expected_revision, revision)
            if any(group.state == 'pending' for group in relevant):
                return
            applied = any(group.state == 'applied' for group in relevant)
            superseded = any(group.state == 'superseded' for group in relevant)
            proposal_state = 'applied' if applied and not superseded else 'rejected'
            revision = entry.expected_revision
        elif proposal.card_id not in input_cards:
            proposal_state = 'rejected'
    if proposal_state == 'applied' and revision is not None:
        entry.state, entry.expected_revision = 'queued', revision
    elif proposal_state in ('rejected', 'superseded'):
        entry.state, entry.error = 'rejected', '修改建议未获批准，因此未生成'


async def freeze_generation_basis(db: AsyncSession, project_id: str | None, entry: CanvasAssistantGeneration) -> None:
    """Bind the exact input and original explicit instruction to a durable decision."""
    if entry.state == 'queued' and entry.basis_hash is None:
        await stage_generation(db, project_id, entry, ordinal=1)


async def advance_waiting_assistant_generation(db, project_id, canvas_id, source_id, result, group_ids) -> None:
    """An edit-gated generation waits for the actual receipts of its selected input edits."""
    await update_generation_for_decision(
        db, canvas_id, source_id, result.proposal.state, result.receipt.revision if result.receipt else None,
        result=result, group_ids=group_ids,
    )
    entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id))
    if entry is not None:
        await freeze_generation_basis(db, project_id, entry)


async def _receipts(db: AsyncSession, entry: CanvasAssistantGeneration) -> dict[str, CanvasRunReceipt]:
    ids = [_request_id(entry.source_id, sequence) for sequence in range(1, entry.requested_count + 1)]
    return {item.request_id: item for item in await db.scalars(select(CanvasRunReceipt).where(
        CanvasRunReceipt.canvas_id == entry.canvas_id, CanvasRunReceipt.request_id.in_(ids),
    ))}


async def _legacy_versions(db, entry):
    receipts = await _receipts(db, entry)
    run_ids = [receipt.response['run_id'] for receipt in receipts.values()]
    rows = await db.execute(select(CanvasRunNode, CanvasRun.revision).join(
        CanvasRun, CanvasRun.id == CanvasRunNode.run_id,
    ).where(CanvasRunNode.run_id.in_(run_ids))) if run_ids else []
    nodes = {node.run_id: (node, revision) for node, revision in rows}
    versions = []
    for version in range(1, entry.requested_count + 1):
        receipt = receipts.get(_request_id(entry.source_id, version))
        if receipt is not None and receipt.response['run_id'] in nodes:
            node, revision = nodes[receipt.response['run_id']]
            versions.append(CanvasAssistantGenerationVersion(version=version, request_id=receipt.request_id,
                run_id=node.run_id, input_revision=revision, state='unknown' if node.stage == SUBMISSION_UNKNOWN else node.status,
                error=node.error_message))
    return versions


async def read_generation(db: AsyncSession, canvas_id: str, source_id: str) -> CanvasAssistantGenerationRead | None:
    """Follow canonical canvas receipts and run states without issuing a new generation."""
    entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id), populate_existing=True)
    if entry is None:
        return None
    if (entry.input_approval or {}).get('versioned'):
        _, versions = await generation_status(db, entry)
    else:
        versions = await _legacy_versions(db, entry)
    state, error = entry.state, entry.error
    active = any(version.state not in ('succeeded', 'failed', 'cancelled') for version in versions)
    if entry.state in ('queued', 'submitted') and active:
        state = 'running'
    elif entry.state == 'submitted':
        if len(versions) == entry.requested_count and all(version.state == 'succeeded' for version in versions):
            state = 'completed'
        else:
            state = 'failed'
            error = next((version.error for version in versions if version.error), None) or error or '有已授权的版本未完成'
    review = CanvasAssistantGenerationReview(
        state=entry.review_state, results=entry.review_results or [],
    ) if entry.review_state else None
    return CanvasAssistantGenerationRead(card_id=entry.card_id, requested_count=entry.requested_count,
        state=state, error=error, versions=versions, review=review,
        changed_input=(entry.input_approval or {}).get('pending') if state == 'reapproval_required' else None)


async def publish_generation_changes(sessions):
    """Publish durable Worker receipts once, including completion after browser exit."""
    async with sessions() as db:
        rows = list(await db.execute(select(
            CanvasAssistantGeneration.canvas_id, CanvasAssistantGeneration.source_id,
        ).where(~CanvasAssistantGeneration.events_closed,
            CanvasAssistantGeneration.state.in_(('queued', 'submitted', 'failed', 'reapproval_required', 'stopped', 'rejected')),
        ).order_by(CanvasAssistantGeneration.event_checked_at, CanvasAssistantGeneration.created_at,
                   CanvasAssistantGeneration.canvas_id, CanvasAssistantGeneration.source_id).limit(64)))
    for canvas_id, source_id in rows:
        async with sessions() as db:
            canvas = await db.get(GenerationCanvas, canvas_id, with_for_update=True)
            entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id), with_for_update=True)
            if not canvas or not entry or entry.events_closed:
                continue
            entry.event_checked_at = utcnow()
            await reconcile_generation(db, canvas.project_id, entry)
            await db.flush()
            generation = await read_generation(db, canvas_id, source_id)
            digest = sha256(generation.model_dump_json().encode()).hexdigest()
            if entry.event_digest == digest or entry.event_digest is None and generation.state == 'queued':
                await db.commit()
                continue
            session = await db.get(CanvasAssistantSession, canvas_id, with_for_update=True)
            turn = await db.get(CanvasAssistantTurn, (canvas_id, source_id))
            if not session or not turn:
                continue
            exchange = CanvasAssistantExchange.model_validate(turn)
            exchange.generation = generation
            status = {
                'reapproval_required': 'execution.blocked', 'failed': 'execution.failed',
                'completed': 'execution.succeeded',
            }.get(generation.state, 'generation.updated')
            publish_events(db, session, exchange, status, subject='generation')
            entry.event_digest = digest
            entry.events_closed = generation.state in ('reapproval_required', 'failed', 'stopped', 'rejected') or (
                generation.state == 'completed' and (
                    not generation.review or generation.review.state not in ('waiting', 'reviewing')))

            await db.commit()


async def reapprove_generation(db, project_id, canvas_id, source_id, command: CanvasAssistantGenerationApproval):
    """Approve changed input after checking the exact preview against the current canvas."""
    await CanvasStore(db, project_id).get(canvas_id, lock=True)
    require_unexpired_approval(await db.get(CanvasAssistantTurn, (canvas_id, source_id)), 'generation')
    entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id), with_for_update=True, populate_existing=True)
    if entry is None:
        raise HTTPException(404, 'Canvas generation authorization not found')
    approval = entry.input_approval or {}
    known = approval.get('decisions', {})
    body = command.model_dump(exclude={'decision_id'})
    if command.decision_id in known:
        if known[command.decision_id] != body:
            raise HTTPException(409, 'Generation approval identity already belongs to different input')
        return await read_generation(db, canvas_id, source_id)
    pending = approval.get('pending')
    if entry.state != 'reapproval_required' or not pending or not approval.get('versioned'):
        raise HTTPException(409, 'This generation is not waiting for new approval')
    if any(pending[key] != value for key, value in body.items()):
        raise HTTPException(409, 'Generation input preview has been replaced')
    if len(known) >= 20:
        raise HTTPException(409, 'Create a fresh authorization for the remaining versions')
    _, versions = await generation_status(db, entry)
    await stage_generation(db, project_id, entry, ordinal=len(versions) + 1, reapproval=command)
    if entry.state == 'queued':
        entry.input_approval = {**entry.input_approval, 'decisions': {**known, command.decision_id: body}}
    entry.events_closed = False
    await db.flush()
    generation = await read_generation(db, canvas_id, source_id)
    session = await db.get(CanvasAssistantSession, canvas_id, with_for_update=True, populate_existing=True)
    turn = await db.get(CanvasAssistantTurn, (canvas_id, source_id))
    if session and turn:
        exchange = CanvasAssistantExchange.model_validate(turn)
        exchange.generation = generation
        event = {'queued': 'approval.decided', 'failed': 'execution.failed'}.get(entry.state, 'execution.blocked')
        publish_events(db, session, exchange, event, subject='generation')
        entry.event_digest = sha256(generation.model_dump_json().encode()).hexdigest()
        entry.events_closed = entry.state in ('reapproval_required', 'failed')
    return generation
