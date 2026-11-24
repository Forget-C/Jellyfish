"""Bind explicit assistant generation instructions to versioned approval receipts."""

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.canvas_assistant import CanvasAssistantGeneration, CanvasAssistantTurn
from app.models.generation_canvas import CanvasRun
from app.schemas.canvas_assistant_generation import CanvasAssistantGenerationApproval, CanvasAssistantGenerationVersion
from app.schemas.generation_canvas import CanvasPrecheck
from app.services.approval import ApprovalAccess, ApprovalError, ApprovalScope, ApprovalService
from app.services.generation_canvas.approved_generation import (
    CanvasGenerationApprovalPreview, CanvasGenerationApprovals, CanvasGenerationExecutionReceipt,
)

_TERMINAL = {'succeeded', 'failed', 'cancelled'}


def _access(entry: CanvasAssistantGeneration, *, decide: bool) -> ApprovalAccess:
    return ApprovalAccess(scope=ApprovalScope(kind='canvas', id=entry.canvas_id),
                          actor_id='canvas-operator' if decide else 'canvas-assistant',
                          permissions={'read', 'decide'} if decide else {'read', 'submit'})


def _input_details(preview: CanvasPrecheck) -> dict:
    return {
        'text': preview.input.text,
        'model': preview.model or {},
        'media': [item.model_dump(mode='json', exclude={'token', 'payload'}) for item in preview.input.media],
    }


def _hold_changed_input(entry: CanvasAssistantGeneration, staged: CanvasGenerationApprovalPreview) -> None:
    approval = entry.input_approval or {}
    entry.state, entry.error = 'reapproval_required', '生成依据已改变，请核对后重新授权剩余版本'
    entry.input_approval = {**approval, 'pending': {
        'before': approval.get('authorized'), 'after': _input_details(staged.precheck),
        'revision': staged.precheck.revision, 'basis_hash': staged.basis_hash,
    }}


async def stage_generation(db: AsyncSession, project_id: str | None, entry: CanvasAssistantGeneration, *,
                           ordinal: int, reapproval: CanvasAssistantGenerationApproval | None = None) -> None:
    """Register only the next authorized variant, with its exact generation basis."""
    approval = entry.input_approval or {}
    versions = approval.get('versioned', {})
    previous = versions.get(str(ordinal))
    service = CanvasGenerationApprovals(db)
    try:
        async with db.begin_nested():
            staged = await service.capture(_access(entry, decide=False), project_id, entry.canvas_id, entry.card_id)
            if reapproval is not None:
                if reapproval.revision != staged.precheck.revision or reapproval.basis_hash != staged.basis_hash:
                    _hold_changed_input(entry, staged)
                    return
            elif entry.basis_hash and entry.basis_hash != staged.basis_hash:
                _hold_changed_input(entry, staged)
                return
            elif entry.basis_hash is None and staged.precheck.revision != entry.expected_revision:
                entry.state, entry.error = 'failed', '画布已在授权后修改，请核对输入后重新授权生成'
                return
            version = f'reapproval:{reapproval.decision_id}' if reapproval else 'original'
            request = await service.submit(
                _access(entry, decide=False), project_id, entry.canvas_id, entry.card_id,
                object_id=f'{entry.source_id}:{ordinal}', version=version, idempotency_key=f'preview:{version}',
                supersedes_request_id=previous['request_id'] if previous else None, staged_preview=staged,
            )
            decision = await ApprovalService(db).decide(
                _access(entry, decide=True), request.id, version=request.version, group_ids=request.group_ids,
                action='approve', idempotency_key=f'confirm:{version}',
            )
    except (ApprovalError, HTTPException) as error:
        detail = error.detail if isinstance(error, HTTPException) else str(error)
        entry.state = 'failed'
        entry.error = detail.get('message', '生成预检未通过') if isinstance(detail, dict) else str(detail)
        return
    entry.basis_hash = staged.basis_hash
    entry.state, entry.error = 'queued', None
    entry.input_approval = {
        **approval, 'pending': None, 'authorized': _input_details(staged.precheck),
        'versioned': {**versions, str(ordinal): {'request_id': request.id, 'decision_id': decision.id}},
    }
    if ordinal == 1:
        turn = await db.get(CanvasAssistantTurn, (entry.canvas_id, entry.source_id))
        turn.approval_requests = {**(turn.approval_requests or {}), 'generation': request.id}


async def generation_status(db: AsyncSession, entry: CanvasAssistantGeneration) -> tuple[
    list[CanvasGenerationExecutionReceipt], list[CanvasAssistantGenerationVersion],
]:
    """Read accepted runs and their immutable approval receipts in variant order."""
    found, versions = [], []
    service = CanvasGenerationApprovals(db)
    access = _access(entry, decide=False)
    for ordinal, identity in sorted(entry.input_approval.get('versioned', {}).items(), key=lambda item: int(item[0])):
        receipt = await service.read_receipt(access, identity['decision_id'])
        found.append(receipt)
        if receipt.admission is not None:
            run = await db.get(CanvasRun, receipt.admission.run_id)
            node = receipt.run.nodes[0] if receipt.run else None
            versions.append(CanvasAssistantGenerationVersion(
                version=int(ordinal), request_id=receipt.admission.request_id, run_id=receipt.admission.run_id,
                input_revision=run.revision if run else (await service.read_snapshot(access, identity['request_id'])).revision,
                state='unknown' if receipt.state == 'unknown' else node.status if node else receipt.state,
                error=node.error_message if node else None,
            ))
    return found, versions


async def reconcile_generation(db: AsyncSession, project_id: str | None, entry: CanvasAssistantGeneration) -> None:
    """Project execution results and stage only the next previously authorized variant."""
    if not (entry.input_approval or {}).get('versioned') or entry.state != 'queued':
        return
    receipts, versions = await generation_status(db, entry)
    latest = receipts[-1]
    if latest.state == 'conflict':
        try:
            staged = await CanvasGenerationApprovals(db).capture(
                _access(entry, decide=False), project_id, entry.canvas_id, entry.card_id,
            )
        except (ApprovalError, HTTPException):
            entry.state, entry.error = 'failed', latest.diagnostic.message if latest.diagnostic else '生成依据已改变'
        else:
            _hold_changed_input(entry, staged)
    elif latest.state == 'failed' and latest.admission is None:
        entry.state, entry.error = 'failed', latest.diagnostic.message if latest.diagnostic else '生成受理失败'
    elif len(versions) == entry.requested_count:
        entry.state = 'submitted'
    elif versions and latest.state in _TERMINAL:
        await stage_generation(db, project_id, entry, ordinal=len(versions) + 1)


async def stop_assistant_generation(db: AsyncSession, entry: CanvasAssistantGeneration) -> None:
    """Stop additional variants and leave runs that are already admitted available to track."""
    versions = (entry.input_approval or {}).get('versioned', {})
    if versions:
        latest = versions[max(versions, key=int)]
        admitted = await CanvasGenerationApprovals(db).stop_pending(_access(entry, decide=True), latest['request_id'])
        if admitted and len(versions) == entry.requested_count:
            entry.state = 'submitted'
            return
    entry.state = 'stopped'
