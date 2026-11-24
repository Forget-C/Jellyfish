"""Bind the existing assistant HTTP surface to durable versioned decisions."""

import re

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.canvas_assistant import CanvasAssistantSession, CanvasAssistantTurn
from app.schemas.canvas_assistant import CanvasAssistantExchange
from app.schemas.canvas_assistant_edit import (
    CanvasAssistantApprovalAudit, CanvasAssistantIndependentReview, CanvasAssistantProposal, CanvasAssistantProposalDecision,
    CanvasAssistantProposalResult,
)
from app.schemas.generation_canvas import CanvasDocument
from app.services.approval import ApprovalAccess, ApprovalError, ApprovalScope, ApprovalService
from app.services.automatic_approval import ApprovalEffect, AutomaticApprovalBasis, AutomaticApprovalService
from app.services.generation_canvas.approval_tools import (
    CanvasApprovalDecisionTool, CanvasApprovalTools, ConfirmedCanvasApproval, DecideCanvasApproval,
    StagedCanvasApproval, SubmitCanvasApproval,
)
from app.services.generation_canvas.approval_upgrade import expired_approval, require_unexpired_approval
from app.services.generation_canvas.approved_edits import CanvasEditApprovals, execute_assistant_edit_request
from app.services.generation_canvas.assistant_approval import automatic_approval_allowed, explicit_canvas_effects
from app.services.generation_canvas.assistant_auto_review import canvas_approval_reviewer
from app.services.generation_canvas.assistant_edit_projection import assistant_edit_result, record_assistant_edit_decision
from app.services.generation_canvas.assistant_events import publish_events
from app.services.generation_canvas.assistant_layout import decide_assistant_layout
from app.services.generation_canvas.assistant_skills import planning_request
from app.services.generation_canvas.edits import CanvasEditGroupPreview, project_canvas_edit_group
from app.services.generation_canvas.store import CanvasStore

_CONSULTATION = re.compile(r'[？?]|如何|怎么|是否|能否|例如|比如|\b(?:how|should|could|example)\b', re.I)
_PLAN_ONLY = re.compile(
    r'只(?:给|看|做|要|展示)(?:一份)?方案|只(?:做)?预演|仅(?:给|做|展示)?(?:方案|预演)|'
    r'(?:不要|不需要|无需|不用|暂不|先不|禁止)(?:直接)?(?:写入|送审|修改画布)|不写入|'
    r'\b(?:plan only|preview only|do not (?:submit|write))\b', re.I,
)


def can_submit_canvas_edit(text: str) -> bool:
    """User requests to plan or consult alone cannot authorize submission."""
    return not (planning_request(text) or _PLAN_ONLY.search(text) or _CONSULTATION.search(text))


def canvas_operator_access(canvas_id: str, *, permissions=frozenset({'read', 'submit', 'decide'}),
                           source='human') -> ApprovalAccess:
    """The existing local canvas operator is bound by the verified canvas host."""
    return ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas_id), actor_id='canvas-operator',
                          permissions=permissions, source=source)


async def issue_canvas_edit_approval(
    db: AsyncSession, project_id: str | None, turn: CanvasAssistantTurn, preview, *, revises: CanvasAssistantTurn | None,
) -> None:
    """Issue a server-held preview in the same transaction as the linked visible turn."""
    access = canvas_operator_access(turn.canvas_id, permissions=frozenset({'submit', 'read'}))
    prior = (revises.approval_requests or {}).get('edit') if revises else None
    if revises and not prior:
        raise expired_approval()
    object_id = (await ApprovalService(db).read(access, prior)).object_id if prior else turn.request_id
    tools = CanvasApprovalTools(db, access, project_id, allow_submit=True)
    scope = StagedCanvasApproval(
        preview_id=preview.preview_id, preview=preview.plan, object_id=object_id,
        version=turn.request_id, idempotency_key=turn.request_id, supersedes_request_id=prior,
    )
    tools.stage(scope)
    request = await tools.submit(SubmitCanvasApproval(preview_id=scope.preview_id, version=scope.version))
    turn.approval_requests = {**(turn.approval_requests or {}), 'edit': request.id}


async def withdraw_canvas_edit(db, turn):
    """Stop remaining pending groups through the same authoritative decision service."""
    request_id = (turn.approval_requests or {}).get('edit')
    if not request_id:
        return
    access = canvas_operator_access(turn.canvas_id)
    service = ApprovalService(db)
    request = await service.read(access, request_id)
    pending = tuple(group_id for group_id in request.group_ids if request.group_states[group_id] == 'pending')
    if request.active and pending:
        await service.decide(access, request.id, version=request.version, group_ids=pending,
                             action='reject', idempotency_key=f'stop:{turn.request_id}')


def _effects(group: CanvasEditGroupPreview) -> tuple[ApprovalEffect, ...]:
    changes = set()
    for diff in group.differences:
        path = diff.path
        if path[0] != 'cards':
            continue
        card_id = path[1]
        if len(path) == 2 and not diff.after.exists:
            changes.add(ApprovalEffect(kind='delete_card', target_id=card_id))
        elif len(path) > 2 and path[2] == 'input_bindings':
            before = {item['id'] for item in diff.before.value or ()}
            after = {item['id'] for item in diff.after.value or ()}
            changes.update(ApprovalEffect(kind='release_binding', target_id=card_id, binding_id=key)
                           for key in before - after)
            if after - before:
                changes.add(ApprovalEffect(kind='edit', target_id=card_id))
        else:
            changes.add(ApprovalEffect(kind='edit', target_id=card_id))
    return tuple(sorted(changes, key=lambda effect: (effect.target_id, effect.kind, effect.binding_id or '')))


class _CanvasAutomaticPolicy:
    def __init__(self, project_id: str | None, canvas_id: str, source_id: str):
        self.project_id, self.canvas_id, self.source_id = project_id, canvas_id, source_id

    async def load_basis(self, db, request, group_id, *, lock):
        canvas = await CanvasStore(db, self.project_id).get(self.canvas_id, lock=lock)
        session = await db.get(CanvasAssistantSession, self.canvas_id, with_for_update=lock, populate_existing=True)
        turn = await db.get(CanvasAssistantTurn, (self.canvas_id, self.source_id), with_for_update=lock,
                            populate_existing=True)
        if (not session or session.approval_mode != 'automatic' or not turn or turn.stopped or turn.instructions
                or turn.canvas_references or not turn.context or not turn.proposal or
                (turn.approval_requests or {}).get('edit') != request.id):
            return None
        document = CanvasDocument.model_validate(canvas.document)
        access = canvas_operator_access(self.canvas_id)
        plan = await CanvasEditApprovals(db).read_snapshot(access, request.id)
        group = next(item for item in plan.groups if item.id == group_id)
        # Recheck the exact approved operation values and adopted source cards.
        try:
            project_canvas_edit_group(document, group)
        except HTTPException:
            return None
        proposal = CanvasAssistantProposal.model_validate(turn.proposal)
        effects = _effects(group)
        if not effects or not can_submit_canvas_edit(turn.text):
            return None
        explicit = explicit_canvas_effects(turn.text, turn.context, document, effects)
        # The command must pass either a scoped field rule or exact sensitive-action rules.
        if not explicit and not automatic_approval_allowed(turn.text, turn.context, proposal, document, (group_id,)):
            return None
        return AutomaticApprovalBasis(
            authority_revision=f'{session.approval_revision}:{canvas.revision}', actor_id=access.actor_id,
            user_request=turn.text, effects=effects, allowed_effects=frozenset(effects), explicit_effects=explicit,
            evidence={'diff': group.model_dump(mode='json'), 'targets': turn.context['target_card_ids']},
        )


async def _locked_turn(db, project_id, canvas_id, source_id):
    canvas = await CanvasStore(db, project_id).get(canvas_id, lock=True)
    if db.get_bind().dialect.name == 'sqlite':
        await db.execute(update(CanvasAssistantSession).where(CanvasAssistantSession.canvas_id == canvas_id)
                         .values(sequence=CanvasAssistantSession.sequence))
    session = await db.get(CanvasAssistantSession, canvas_id, with_for_update=True, populate_existing=True)
    turn = await db.get(CanvasAssistantTurn, (canvas_id, source_id), with_for_update=True, populate_existing=True)
    if not session or not turn or not turn.proposal:
        raise HTTPException(404, 'Canvas assistant proposal not found')
    require_unexpired_approval(turn, 'edit')
    if not (turn.approval_requests or {}).get('edit'):
        raise expired_approval()
    return canvas, session, turn


def _http_error(error: ApprovalError):
    status = {'invalid_groups': 422, 'invalid_decision': 422, 'forbidden': 403, 'request_not_found': 404}
    return HTTPException(status.get(error.code, 409), str(error))


async def _automatic_decisions(db, sessions, project_id, turn, request, groups):
    canvas_id, source_id, model_id = turn.canvas_id, turn.request_id, turn.model_id
    await db.rollback()
    service = AutomaticApprovalService(
        sessions, _CanvasAutomaticPolicy(project_id, canvas_id, source_id), canvas_approval_reviewer(sessions, model_id),
    )
    returns = await service.approve(canvas_operator_access(canvas_id, source='automatic'), request.id,
                                    version=request.version, group_ids=groups)
    choices = [(result.decision, CanvasAssistantIndependentReview(status='approved', reviewer_model_id=model_id,
                reason=result.reason)) for result in returns if result.decision is not None]
    if choices:
        return choices, None
    first = next((result for result in returns if result.status in ('manual_required', 'unavailable')), None)
    if first:
        return [], CanvasAssistantIndependentReview(status=first.status, reviewer_model_id=model_id, reason=first.reason)
    raise HTTPException(409, 'Automatic approval requires an explicit user request for this change')


async def decide_canvas_assistant_proposal(
    db: AsyncSession, project_id: str | None, canvas_id: str, source_id: str, body: CanvasAssistantProposalDecision,
) -> CanvasAssistantProposalResult:
    """Sign the exact linked source and execute via the same receipt path as the Worker."""
    from app.services.generation_canvas.assistant_generation import advance_waiting_assistant_generation, read_generation

    sessions = async_sessionmaker(bind=db.bind, expire_on_commit=False)
    canvas, session, turn = await _locked_turn(db, project_id, canvas_id, source_id)
    if body.expected_revision > canvas.revision or turn.stopped:
        raise expired_approval()
    access = canvas_operator_access(canvas_id)
    service = ApprovalService(db)
    request = await service.read(access, turn.approval_requests['edit'])
    groups = tuple(body.group_ids or (() if len(request.group_ids) != 1 else request.group_ids))
    if not groups or len(set(groups)) != len(groups) or set(groups) - set(request.group_ids):
        raise HTTPException(422, '请选择此审批卡上明确的改动组')
    groups = tuple(group_id for group_id in request.group_ids if group_id in groups)
    if body.approve_layout and (body.action != 'approve' or not body.decision_id):
        raise HTTPException(422, '布局必须通过具有重试标识的人工批准')
    automatic = body.approval_mode == 'automatic'
    review = None
    try:
        if automatic:
            if body.action != 'approve' or body.approve_layout:
                raise HTTPException(422, '自动审批仅能批准已明确授权的改动')
            choices, review = await _automatic_decisions(db, sessions, project_id, turn, request, groups)
            _, session, turn = await _locked_turn(db, project_id, canvas_id, source_id)
        else:
            choice = DecideCanvasApproval(request_id=request.id, version=request.version, group_ids=groups, action=body.action)
            key = body.decision_id or CanvasStore.command_digest({'source': source_id, 'decision': choice.model_dump(mode='json')})
            state = turn.proposal_receipt or {}
            layout_options = state.get('_decision_layout', {})
            if key in layout_options and layout_options[key] != body.approve_layout:
                raise ApprovalError('idempotency_conflict', '原审批决定对应的布局选择已变化')
            tool = CanvasApprovalDecisionTool(db, access, confirmed=ConfirmedCanvasApproval(choice=choice, idempotency_key=key))
            choices = [(await tool.decide(choice), None)]
            turn.proposal_receipt = {**state, '_decision_layout': {**layout_options, key: body.approve_layout}}
    except ApprovalError as error:
        raise _http_error(error) from error
    if body.approve_layout and body.action == 'approve':
        await decide_assistant_layout(db, project_id, canvas_id, source_id, 'approve')
    for decision, evidence in choices:
        record_assistant_edit_decision(db, session, turn, decision, evidence)
        if decision.action == 'reject':
            await advance_waiting_assistant_generation(db, project_id, canvas_id, source_id,
                assistant_edit_result(turn, decision, ()), list(decision.group_ids))
    if review:
        entry = CanvasAssistantApprovalAudit(source_id=source_id, mode='automatic', action='approve',
            outcome='manual_required', group_ids=list(groups), decision_id=body.decision_id, review=review).model_dump(mode='json')
        if entry not in (turn.approval_audit or ()):
            turn.approval_audit = [*(turn.approval_audit or []), entry]
            publish_events(db, session, CanvasAssistantExchange.model_validate(turn), 'proposal.reviewed', subject='edit',
                           group_ids=list(groups))
    await db.commit()
    if choices and body.action == 'approve':
        await execute_assistant_edit_request(sessions, request.id, canvas_id, project_id, len(request.group_ids))
    # A new transaction sees the accepted decision and any Worker progress.
    db.expire_all()
    turn = await db.get(CanvasAssistantTurn, (canvas_id, source_id), populate_existing=True)
    reopened = await CanvasStore(db, project_id).read(canvas_id)
    if choices:
        approvals = CanvasEditApprovals(db)
        receipts = []
        for decision, _ in choices:
            receipts.extend(await approvals.read_receipts(access, decision.id))
        result = assistant_edit_result(turn, choices[0][0], tuple(receipts), reopened)
    else:
        result = CanvasAssistantProposalResult(proposal=CanvasAssistantProposal.model_validate(turn.proposal), canvas=reopened)
    result.automatic_review = review or (choices[0][1] if choices else None)
    result.generation = await read_generation(db, canvas_id, source_id)
    return result
