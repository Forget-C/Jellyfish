"""Admit only the versions authorized in the current user's own message."""

import re
from hashlib import sha256

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.canvas_assistant import CanvasAssistantGeneration, CanvasAssistantTurn
from app.models.generation_canvas import CanvasPreview, CanvasRun, CanvasRunNode, CanvasRunReceipt, CanvasScopeOccupancy, GenerationCanvas
from app.schemas.canvas_assistant_edit import CanvasAssistantProposalDecision, CanvasAssistantProposalResult
from app.schemas.canvas_assistant_generation import (CanvasAssistantGenerationRead, CanvasAssistantGenerationReview,
                                                       CanvasAssistantGenerationVersion)
from app.schemas.generation_canvas import CanvasDocument, CanvasPrecheckRequest, CanvasRunSubmit
from app.services.generation_canvas.assistant_edits import resolve_assistant_proposal
from app.services.generation_canvas.assistant_targets import shot_request_matches
from app.services.generation_canvas.runtime import CanvasRuntime
from app.services.generation_canvas.store import CanvasStore
from app.services.task_service import utcnow


_DIGITS = dict(zip('一二三四五六七八九', range(1, 10))) | {'两': 2}
_CHINESE_REQUEST = re.compile(
    r'(?:请|帮我|给我)?(?:再)?生成\s*(?P<count>[1-9][0-9]?|[一二两三四五六七八九]?十[一二三四五六七八九]?'
    r'|[一二两三四五六七八九])\s*(?:个)?(?:版|版本|次)'
    r'(?:[，,。；;]\s*(?:再|完成后|生成后)(?:帮我)?(?P<review>(?:看看|看|复看|审看|点评|检查)[^？?]*))?[。！!]?'
)
_ENGLISH_REQUEST = re.compile(
    r'(?:please )?(?:re)?generate (?P<count>[1-9][0-9]?|one|two|three) versions?[.!]?', re.IGNORECASE,
)
_EDIT_PREFIX = re.compile(r'^(?:请|帮我)?(?:先)?(?:把|将|修改|改写|调整|更新|优化|改好后|修改后|调整后|更新后)')
_AFTER_EDIT = ('改好后', '修改后', '调整后', '更新后')


def _explicit_quantity(text: str) -> tuple[int, bool, str | None] | None:
    """Match a bounded imperative and optional edit prerequisite in the user turn."""
    if any(mark in text for mark in ('「', '『', '“', '”', '"', '`', '？', '?')):
        return None
    request = text.strip()
    waits_for_edit = request.startswith(_AFTER_EDIT)
    if waits_for_edit:
        ending = next(prefix for prefix in _AFTER_EDIT if request.startswith(prefix))
        request = request.removeprefix(ending).lstrip('，, ')
    else:
        split = re.search(r'(?:[，,；;。]\s*|(?:改好|修改|调整|更新)后\s*|并\s*)(?:然后|并)?\s*'
                          r'(?=(?:请|帮我|给我|再)?生成)', request)
        if split and _EDIT_PREFIX.match(request):
            prefix = request[:split.start()]
            if any(word in prefix for word in ('生成', '不要', '别', '是否', '能否', '例如', '比如', '如果')):
                return None
            waits_for_edit = True
            request = request[split.end():]
    match = _CHINESE_REQUEST.fullmatch(request) or _ENGLISH_REQUEST.fullmatch(request)
    if match is None:
        return None
    count = match['count'].lower()
    review = match.groupdict().get('review')
    if count.isascii() and count.isdecimal():
        quantity = int(count)
    elif count in ('one', 'two', 'three'):
        quantity = ('one', 'two', 'three').index(count) + 1
    elif '十' in count:
        tens, units = count.split('十')
        quantity = 10 * _DIGITS.get(tens, 1) + _DIGITS.get(units, 0)
    else:
        quantity = _DIGITS[count]
    return quantity, waits_for_edit, review


def generation_authorization(turn: CanvasAssistantTurn, document: CanvasDocument,
                             revision: int) -> CanvasAssistantGeneration | None:
    """Freeze the selected model card and quantity without interpreting model output as permission."""
    authority = _explicit_quantity(turn.text)
    context = turn.context
    if authority is None or turn.revises or not context or context['scope'] != 'selection':
        return None
    count, waits_for_edit, review = authority
    target_ids = context['target_card_ids']
    if len(target_ids) != 1:
        return None
    card_id, = target_ids
    card = next((item for item in document.cards if item.id == card_id and item.type.startswith('model.')), None)
    if card is None or not shot_request_matches(turn.text, document, card_id):
        return None
    state, error = ('waiting_approval', None) if waits_for_edit else ('queued', None)
    if waits_for_edit and not turn.proposal:
        state, error = 'failed', '未获得可审批的修改建议，因此未生成'
    if not waits_for_edit:
        saved = {item.id: item.model_dump(mode='json') for item in document.cards}
        if context['revision'] != revision or any(saved.get(item['id']) != item for item in context['cards']):
            state, error = 'failed', '画布输入存在未保存的改动，请保存并重新明确授权生成'
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
            proposal_state = 'applied' if any(group.state == 'applied' for group in relevant) else 'rejected'
            revision = entry.expected_revision
        elif proposal.card_id not in input_cards:
            proposal_state = 'rejected'
    if proposal_state == 'applied' and revision is not None:
        entry.state, entry.expected_revision = 'queued', revision
    elif proposal_state in ('rejected', 'superseded'):
        entry.state, entry.error = 'rejected', '修改建议未获批准，因此未生成'


async def decide_assistant_generation_edit(
    db: AsyncSession, project_id: str, canvas_id: str, source_id: str, body: CanvasAssistantProposalDecision,
) -> CanvasAssistantProposalResult:
    """An edit decision and its effect on a waiting generation commit together."""
    result = await resolve_assistant_proposal(db, project_id, canvas_id, source_id, body)
    if result.replayed:
        result.generation = await read_generation(db, canvas_id, source_id)
        return result
    await update_generation_for_decision(
        db, canvas_id, source_id, result.proposal.state, result.receipt.revision if result.receipt else None,
        result=result, group_ids=body.group_ids,
    )
    await db.flush()
    entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id))
    if entry and entry.state == 'queued' and entry.basis_hash is None:
        await freeze_generation_basis(db, project_id, entry)
    result.generation = await read_generation(db, canvas_id, source_id)
    return result


async def freeze_generation_basis(db: AsyncSession, project_id: str | None, entry: CanvasAssistantGeneration) -> None:
    """Record the effective input as soon as the user's prerequisites are satisfied."""
    try:
        async with db.begin_nested():
            preview = await CanvasRuntime(db, project_id).precheck(
                entry.canvas_id, CanvasPrecheckRequest(card_id=entry.card_id),
            )
            if preview.revision != entry.expected_revision:
                entry.state, entry.error = 'failed', '画布已在授权后修改，请核对输入后重新授权生成'
            elif preview.preview_token is None:
                entry.state = 'failed'
                entry.error = next((issue.message for issue in preview.diagnostics if 'run' in issue.blocks), '生成预检未通过')
            else:
                basis = await db.get(CanvasPreview, preview.preview_token)
                entry.basis_hash = basis.basis_hash
                await db.delete(basis)
    except HTTPException as error:
        _fail_generation(entry, error)


def _fail_generation(entry: CanvasAssistantGeneration, error: HTTPException) -> None:
    entry.state = 'failed'
    entry.error = error.detail.get('message', '生成预检未通过') if isinstance(error.detail, dict) else str(error.detail)


def _request_id(source_id: str, version: int) -> str:
    return 'assistant-run:' + sha256(f'{version}:{source_id}'.encode()).hexdigest()[:48]


async def _receipts(db: AsyncSession, entry: CanvasAssistantGeneration) -> dict[str, CanvasRunReceipt]:
    ids = [_request_id(entry.source_id, sequence) for sequence in range(1, entry.requested_count + 1)]
    return {item.request_id: item for item in await db.scalars(select(CanvasRunReceipt).where(
        CanvasRunReceipt.canvas_id == entry.canvas_id, CanvasRunReceipt.request_id.in_(ids),
    ))}


async def read_generation(db: AsyncSession, canvas_id: str, source_id: str) -> CanvasAssistantGenerationRead | None:
    """Follow canonical canvas receipts and run states without issuing a new generation."""
    entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id), populate_existing=True)
    if entry is None:
        return None
    receipts = await _receipts(db, entry)
    run_ids = [receipt.response['run_id'] for receipt in receipts.values()]
    rows = await db.execute(select(CanvasRunNode, CanvasRun.revision).join(
        CanvasRun, CanvasRun.id == CanvasRunNode.run_id,
    ).where(CanvasRunNode.run_id.in_(run_ids))) if run_ids else []
    nodes = {node.run_id: (node, revision) for node, revision in rows}
    versions = []
    for version in range(1, entry.requested_count + 1):
        receipt = receipts.get(_request_id(source_id, version))
        if receipt is not None and receipt.response['run_id'] in nodes:
            node, revision = nodes[receipt.response['run_id']]
            versions.append(CanvasAssistantGenerationVersion(version=version, request_id=receipt.request_id,
                run_id=node.run_id, input_revision=revision, state=node.status, error=node.error_message))
    state, error = entry.state, entry.error
    active = any(version.state not in ('succeeded', 'failed', 'cancelled') for version in versions)
    if entry.state in ('queued', 'submitted') and active:
        state = 'running'
    elif entry.state == 'submitted':
        if len(versions) == entry.requested_count and all(version.state == 'succeeded' for version in versions):
            state = 'completed'
        else:
            state = 'failed'
            error = next((version.error for version in versions if version.error), None) or '有已授权的版本未完成'
    review = CanvasAssistantGenerationReview(
        state=entry.review_state, results=entry.review_results or [],
    ) if entry.review_state else None
    return CanvasAssistantGenerationRead(card_id=entry.card_id, requested_count=entry.requested_count,
        state=state, error=error, versions=versions, review=review)


async def advance_assistant_generations(sessions) -> None:
    """Submit one available version per authorization while preserving existing single-card occupancy."""
    async with sessions() as db:
        rows = list(await db.execute(select(
            CanvasAssistantGeneration.canvas_id, CanvasAssistantGeneration.source_id, GenerationCanvas.project_id,
        ).join(GenerationCanvas, GenerationCanvas.id == CanvasAssistantGeneration.canvas_id).outerjoin(
            CanvasScopeOccupancy, (CanvasScopeOccupancy.canvas_id == CanvasAssistantGeneration.canvas_id)
                & (CanvasScopeOccupancy.card_id == CanvasAssistantGeneration.card_id),
        ).where(
            CanvasAssistantGeneration.state == 'queued', CanvasScopeOccupancy.node_id.is_(None),
        ).order_by(CanvasAssistantGeneration.created_at, CanvasAssistantGeneration.source_id).limit(16)))
    for canvas_id, source_id, project_id in rows:
        async with sessions() as db:
            await _advance_generation(db, canvas_id, source_id, project_id)
            await db.commit()


async def _advance_generation(db, canvas_id: str, source_id: str, project_id: str | None) -> None:  # pylint: disable=too-many-return-statements
    try:
        canvas = await CanvasStore(db, project_id).get(canvas_id, lock=True)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        return
    entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id), with_for_update=True, populate_existing=True)
    if entry is None or entry.state != 'queued':
        return
    receipts = await _receipts(db, entry)
    if len(receipts) == entry.requested_count:
        entry.state = 'submitted'
        return
    if await db.get(CanvasScopeOccupancy, (canvas_id, entry.card_id)):
        return
    if canvas.revision != entry.expected_revision:
        entry.state, entry.error = 'failed', '画布已在授权后修改，请核对输入后重新授权生成'
        return
    version = next(index for index in range(1, entry.requested_count + 1) if _request_id(source_id, index) not in receipts)
    runtime = CanvasRuntime(db, project_id)
    try:
        # Runtime may flush before rejecting. Keep partial admissions out of the authorization transaction.
        async with db.begin_nested():
            preview = await runtime.precheck(canvas_id, CanvasPrecheckRequest(card_id=entry.card_id))
            if preview.preview_token is None:
                entry.state = 'failed'
                entry.error = next((issue.message for issue in preview.diagnostics if 'run' in issue.blocks), '生成预检未通过')
                return
            basis = await db.get(CanvasPreview, preview.preview_token)
            if entry.basis_hash is not None and entry.basis_hash != basis.basis_hash:
                entry.state, entry.error = 'failed', '生成依据已改变，请核对后重新授权剩余版本'
                return
            await runtime.submit(canvas_id, CanvasRunSubmit(
                request_id=_request_id(source_id, version), preview_token=preview.preview_token,
            ))
            entry.basis_hash = basis.basis_hash
            if len(receipts) + 1 == entry.requested_count:
                entry.state = 'submitted'
    except HTTPException as error:
        code = error.detail.get('code') if isinstance(error.detail, dict) else None
        if code != 'RUN_SCOPE_BUSY':
            _fail_generation(entry, error)
