"""Preview and approve the assistant's narrow, user-authorized canvas edits."""

from copy import copy
import hashlib
from uuid import uuid4
from typing import Annotated

from fastapi import HTTPException
from langchain_core.tools import ToolException, tool
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation_canvas import DesignField
from app.models.canvas_assistant import CanvasAssistantSession, CanvasAssistantTurn
from app.schemas.canvas_assistant import CanvasAssistantReadContext
from app.schemas.canvas_assistant_edit import (
    CanvasAssistantChange, CanvasAssistantEditConflict, CanvasAssistantEditGroup,
    CanvasAssistantApprovalAudit, CanvasAssistantEditTarget, CanvasAssistantEditText, CanvasAssistantFieldTarget,
    CanvasAssistantProposal, CanvasAssistantProposalDecision, CanvasAssistantProposalResult,
    CanvasAssistantRemovalTarget, CardTextEdit, DeleteCardEdit, DesignTextFieldEdit, DisconnectCardsEdit, ModelPromptSegmentEdit,
    MovementFieldEdit, ProposedBatchCard, ProposedBatchField, ProposedBatchRemoval, ProposedCanvasBatch, ProposedEditGroup, ReleaseBindingEdit,
    VideoPromptSegmentEdit,
)
from app.schemas.canvas_assistant_structure import (
    AddCanvasCardTarget, AdoptFirstFrameTarget, AdjustShotMovementTarget, ConnectCardsTarget,
)
from app.schemas.generation_canvas import (
    CanvasDocument, CanvasSave, CreativeBasisCard, ModelCard, MovementCard, ObjectDescriptionCard, PromptText,
    TextContentCard, VideoModelCard,
)
from app.services.generation_canvas.catalog import CARD_TITLES, design_fields
from app.services.generation_canvas.allowed_cards import FREE_CARD_TYPES
from app.services.generation_canvas.assistant_approval import automatic_approval_allowed
from app.services.generation_canvas.assistant_removals import apply_removal, removal_impact
from app.services.generation_canvas.assistant_structure import (
    apply_structural_change, assistant_card_configuration, preview_assistant_connection,
)
from app.services.generation_canvas.store import CanvasStore


_TEXT_CONTENT = (TextContentCard, CreativeBasisCard, ObjectDescriptionCard)


def _editable_text(card, target: CanvasAssistantEditTarget):
    if isinstance(target, CardTextEdit) and isinstance(card, _TEXT_CONTENT):
        return card
    if isinstance(target, MovementFieldEdit) and isinstance(card, MovementCard):
        field = getattr(card.fields, target.field)
        # A structured field can own references. This operation only edits plain text.
        if field.document is None:
            return field
    if isinstance(target, DesignTextFieldEdit) and card is not None:
        if any(definition.id == target.field_name for definition in design_fields(type(card))):
            field = getattr(getattr(card, 'fields', card), target.field_name, None)
            if isinstance(field, DesignField) and getattr(field, 'document', None) is None and not hasattr(field, 'size'):
                return field
    if isinstance(card, ModelCard) and (
        isinstance(target, ModelPromptSegmentEdit)
        or isinstance(card, VideoModelCard) and isinstance(target, VideoPromptSegmentEdit)
    ):
        return next((part for part in card.prompt.segments
                     if isinstance(part, PromptText) and part.id == target.segment_id), None)
    return None


class CanvasAssistantEditDraft:
    """Build one in-memory preview from the chosen saved cards."""

    def __init__(self, context: CanvasAssistantReadContext, saved_document: CanvasDocument, visible_document=None):
        target_ids = set(context.target_card_ids)
        self.cards = {card['id']: card for card in context.cards if card['id'] in target_ids}
        self.saved_cards = {card.id: card for card in saved_document.cards if card.id in self.cards}
        self.visible_document = visible_document or saved_document
        self.proposal: CanvasAssistantProposal | None = None

    @property
    def available(self) -> bool:
        """Only an existing editable card can get a proposal tool."""
        return any((isinstance(card, (ModelCard, *_TEXT_CONTENT)) or design_fields(type(card)))
                   and self.cards[card.id]['type'] == card.type
                   for card in self.saved_cards.values())

    def _preview(self, card_id: str, target: CanvasAssistantEditTarget, text: str) -> CanvasAssistantChange:
        saved = self.saved_cards.get(card_id)
        if saved is None or self.cards[card_id]['type'] != saved.type:
            raise ToolException('Choose an existing card in the locked scope')
        card = type(saved).model_validate(self.cards[card_id])
        field = _editable_text(card, target)
        if field is None or field.text == text:
            raise ToolException('Choose an existing plain-text field and provide different text')
        return CanvasAssistantChange(
            card_id=card_id, card_name=CARD_TITLES[card.type], target=target, before=field.text, after=text,
        )

    def tool(self):
        """Expose a preview operation with no document writes or generation."""
        @tool
        async def propose_canvas_edit(card_id: str, target: CanvasAssistantFieldTarget, text: CanvasAssistantEditText) -> str:
            """Preview a clearly requested change to one existing video prompt segment or movement field."""
            if self.proposal or len(self.cards) != 1:
                raise ToolException('Choose grouping for multiple cards or changes')
            self.proposal = CanvasAssistantProposal(**self._preview(card_id, target, text).model_dump())
            return self.proposal.model_dump_json()

        propose_canvas_edit.handle_tool_error = True
        propose_canvas_edit.handle_validation_error = True
        return propose_canvas_edit

    def groups_tool(self):
        """Offer one set of groups containing distinct editable fields."""
        @tool
        async def propose_canvas_edit_groups(groups: Annotated[list[ProposedEditGroup], Field(min_length=1, max_length=8)]) -> str:
            """Preview a clearly requested set of changes. Bundle dependent fields together and independent changes separately."""
            if self.proposal:
                raise ToolException('A preview has already been prepared for this turn')
            result = []
            targets = set()
            for number, group in enumerate(groups, start=1):
                edits = []
                for change in group.edits:
                    key = (change.card_id, change.target.model_dump_json())
                    if key in targets:
                        raise ToolException('Each proposed field must appear once')
                    targets.add(key)
                    edits.append(self._preview(change.card_id, change.target, change.text))
                result.append(CanvasAssistantEditGroup(id=str(number), title=group.title, edits=edits))
            self.proposal = CanvasAssistantProposal(**result[0].edits[0].model_dump(), groups=result)
            return self.proposal.model_dump_json()

        propose_canvas_edit_groups.handle_tool_error = True
        propose_canvas_edit_groups.handle_validation_error = True
        return propose_canvas_edit_groups

    def preview_batch(self, groups: ProposedCanvasBatch) -> CanvasAssistantProposal:
        """Validate a mixed preview through the same catalog and scope used by approval."""
        if self.proposal:
            raise ToolException('A preview has already been prepared for this turn')
        preview = []
        targets: set[tuple[str, str]] = set()
        for number, group in enumerate(groups, start=1):
            local = copy(self)
            local.saved_cards = dict(self.saved_cards)
            local.visible_document = self.visible_document.model_copy(deep=True)
            references: dict[str, str] = {}
            edits = []
            for operation in group.changes:
                change = self._batch_operation(local, operation, references)
                key = change.card_id, change.target.model_dump_json(exclude={'connection_id'})
                if key in targets:
                    raise ToolException('Each proposed change must appear once')
                targets.add(key)
                edits.append(change)
            preview.append(CanvasAssistantEditGroup(id=str(number), title=group.title, edits=edits))
        self.proposal = CanvasAssistantProposal(**preview[0].edits[0].model_dump(), groups=preview)
        return self.proposal

    def _batch_operation(self, local, operation, references):
        if isinstance(operation, ProposedBatchField):
            edit = operation.change
            return self._preview(edit.card_id, edit.target, edit.text)
        if isinstance(operation, ProposedBatchRemoval):
            change = local._preview_removal(operation.card_id, operation.target)
            apply_removal(local.visible_document, change.card_id, change.target)
            if isinstance(change.target, DeleteCardEdit):
                local.saved_cards.pop(change.card_id)
            return change
        if isinstance(operation, ProposedBatchCard):
            if operation.reference in references or operation.reference in self.cards:
                raise ToolException('Each new card reference must be unique within its group')
            try:
                card, text = assistant_card_configuration(operation.card, uuid4().hex)
            except ValueError as exc:
                raise ToolException('Choose a card available in the catalog') from exc
            if not local.visible_document.project_id and card.type not in FREE_CARD_TYPES:
                raise ToolException(f'当前画布不允许创建 {CARD_TITLES[card.type]}')
            references[operation.reference] = card.id
            local.saved_cards[card.id] = card
            local.visible_document.cards.append(card)
            return CanvasAssistantChange(card_id=card.id, card_name=CARD_TITLES[card.type], before='', after=text,
                                         target=AddCanvasCardTarget(kind='add_canvas_card', card=operation.card))
        connection = operation.model_copy(update={
            'source_card': references.get(operation.source_card, operation.source_card),
            'target_card': references.get(operation.target_card, operation.target_card),
        })
        return preview_assistant_connection(local, connection)

    def batch_tool(self):
        """Expose the unified operation as a typed read-only preview tool."""
        @tool
        def propose_canvas_changes(groups: ProposedCanvasBatch) -> str:
            """Preview changes. Keep dependent changes together; connect new cards by their group reference."""
            return self.preview_batch(groups).model_dump_json()

        propose_canvas_changes.handle_tool_error = True
        propose_canvas_changes.handle_validation_error = True
        return propose_canvas_changes

    def _preview_removal(self, card_id, target):
        if card_id not in self.saved_cards:
            raise ToolException('Choose one existing card in the locked scope')
        if isinstance(target, DisconnectCardsEdit) and not any(
            edge.id == target.edge_id and edge.source_card in self.saved_cards for edge in self.visible_document.edges
        ):
            raise ToolException('Choose one existing connection whose endpoints are within the locked scope')
        impact = removal_impact(self.visible_document, card_id, target)
        if impact is None:
            raise ToolException('The removal has no valid target or would remove protected adopted content')
        card = self.saved_cards[card_id]
        titles = {'delete_card': '删除卡片', 'disconnect_cards': '解除连接', 'release_binding': '解除已采用引用'}
        title = titles[target.kind]
        return CanvasAssistantChange(
            card_id=card_id, card_name=getattr(card, 'name', '') or CARD_TITLES[card.type], target=target,
            before=impact[0], after=title, impact_fingerprint=impact[1],
        )

    def removal_tool(self):
        """Preview a single explicit or inferred removal without changing the document."""
        @tool
        async def propose_canvas_removal(card_id: str, target: CanvasAssistantRemovalTarget) -> str:
            """Preview deletion of a card, disconnection of a candidate edge, or release of an adopted input."""
            if self.proposal:
                raise ToolException('A preview has already been prepared for this turn')
            change = self._preview_removal(card_id, target)
            title = change.after
            self.proposal = CanvasAssistantProposal(
                **change.model_dump(), groups=[CanvasAssistantEditGroup(id='1', title=title, edits=[change])],
            )
            return self.proposal.model_dump_json()

        propose_canvas_removal.handle_tool_error = True
        propose_canvas_removal.handle_validation_error = True
        return propose_canvas_removal


async def resolve_assistant_proposal(
    db: AsyncSession, project_id: str, canvas_id: str, source_id: str, decision: CanvasAssistantProposalDecision,
) -> CanvasAssistantProposalResult:
    """Record the decision with the ordinary canvas CAS save in one transaction."""
    store = CanvasStore(db, project_id)
    canvas = await store.get(canvas_id, lock=True)
    turn = await db.get(CanvasAssistantTurn, (canvas_id, source_id), with_for_update=True, populate_existing=True)
    if turn is None or turn.proposal is None:
        raise HTTPException(404, 'Canvas assistant proposal not found')
    proposal = CanvasAssistantProposal.model_validate(turn.proposal)
    receipts = turn.proposal_receipt or {}
    selected = sorted(decision.group_ids or ())
    command = {'action': decision.action, 'mode': decision.approval_mode, 'groups': selected}
    decision_key = f'decision:{decision.decision_id}' if decision.decision_id else None
    if decision_key and (recorded := receipts.get(decision_key)):
        if recorded['command'] != command:
            raise HTTPException(409, 'Assistant decision identity already belongs to another action')
        return await _replay_decision(store, canvas_id, proposal, recorded)
    if decision.approval_mode == 'automatic':
        session = await db.get(CanvasAssistantSession, canvas_id, populate_existing=True)
        if (decision.action != 'approve' or session is None or session.approval_mode != 'automatic'
                or not automatic_approval_allowed(
                    turn.text, turn.context, proposal, CanvasDocument.model_validate(canvas.document), decision.group_ids)):
            raise HTTPException(409, 'Automatic approval requires an explicit user request for this change')
    if decision.expected_revision > canvas.revision:
        raise HTTPException(409, 'Canvas revision does not exist')
    if proposal.groups:
        result = await _resolve_groups(store, canvas, turn, proposal, decision, decision_key)
    else:
        result = await _resolve_single(store, canvas, turn, proposal, decision)
    if decision_key:
        turn.proposal_receipt = {
            **(turn.proposal_receipt or {}),
            decision_key: {
                'command': command,
                'state': result.proposal.state,
                'group_states': {group.id: group.state for group in result.proposal.groups or []},
                'receipt': result.receipt.model_dump(mode='json') if result.receipt else None,
                'conflicts': [item.model_dump(mode='json') for item in result.conflicts],
            },
        }
    return result


async def _resolve_single(store, canvas, turn, proposal, decision):
    canvas_id = canvas.id
    if decision.group_ids is not None:
        raise HTTPException(422, 'This assistant proposal has no edit groups')
    if proposal.state == 'applied' and decision.action == 'approve':
        receipt = {key: value for key, value in (turn.proposal_receipt or {}).items()
                   if not key.startswith('decision:')}
        return await _replay_decision(store, canvas_id, proposal, {'receipt': receipt or None, 'conflicts': []})
    if proposal.state == 'rejected' and decision.action == 'reject':
        return CanvasAssistantProposalResult(proposal=proposal)
    if proposal.state != 'pending':
        raise HTTPException(409, 'Canvas assistant proposal has already been decided')
    if decision.action == 'reject':
        proposal.state = 'rejected'
        turn.proposal = proposal.model_dump(mode='json')
        _record_decision(turn, decision, 'rejected')
        return CanvasAssistantProposalResult(proposal=proposal)

    document = CanvasDocument.model_validate(canvas.document)
    card = next((item for item in document.cards if item.id == proposal.card_id), None)
    field = _editable_text(card, proposal.target)
    if field is None or field.text != proposal.before:
        if decision.decision_id or decision.approval_mode == 'automatic':
            _record_decision(turn, decision, 'conflict')
            return CanvasAssistantProposalResult(proposal=proposal, canvas=await store.read(canvas_id), conflicts=[
                CanvasAssistantEditConflict(group_id='', card_id=proposal.card_id, target=proposal.target,
                                            current=field.text if field is not None else None),
            ])
        raise HTTPException(409, 'Canvas assistant proposal needs a new preview')
    _apply_text(card, field, proposal)
    request_id = 'assistant:' + hashlib.sha256(turn.request_id.encode()).hexdigest()[:48]
    receipt = await store.save(canvas_id, CanvasSave(
        request_id=request_id, expected_revision=canvas.revision, document=document.model_dump(mode='json'),
    ))
    proposal.state = 'applied'
    turn.proposal = proposal.model_dump(mode='json')
    turn.proposal_receipt = {**(turn.proposal_receipt or {}), **receipt}
    _record_decision(turn, decision, 'applied')
    return CanvasAssistantProposalResult(proposal=proposal, receipt=receipt, canvas=await store.read(canvas_id))


def _apply_text(card, field, change: CanvasAssistantChange) -> None:
    field.text = change.after
    if isinstance(field, DesignField):
        field.authorship = 'user'
        field.extraction_context = None
        field.extraction_reason = None
    elif isinstance(card, VideoModelCard) and card.generated_prompt:
        card.generated_prompt.edit_confirmed = True


async def _resolve_groups(store, canvas, turn, proposal, decision, decision_key) -> CanvasAssistantProposalResult:
    groups = {group.id: group for group in proposal.groups}
    if decision.group_ids is None:
        raise HTTPException(422, 'Select the assistant edit groups to decide')
    selected = sorted(decision.group_ids)
    if len(set(selected)) != len(selected) or any(group_id not in groups for group_id in selected):
        raise HTTPException(422, 'Unknown or repeated assistant edit group')
    identity = (turn.request_id, decision_key) if decision_key else (turn.request_id, decision.action, *selected)
    digest = hashlib.sha256(':'.join(identity).encode()).hexdigest()[:48]
    receipts = turn.proposal_receipt or {}
    recorded = receipts.get(digest)
    if recorded:
        return await _replay_decision(store, canvas.id, proposal, recorded)
    if proposal.state == 'superseded' or any(groups[group_id].state != 'pending' for group_id in selected):
        raise HTTPException(409, 'An assistant edit group has already been decided')
    if decision.action == 'reject':
        for group_id in selected:
            groups[group_id].state = 'rejected'
        receipt, conflicts = None, []
    else:
        receipt, conflicts = await _apply_groups(store, canvas, [groups[group_id] for group_id in selected], digest)
    states = {group.state for group in groups.values()}
    proposal.state = 'pending' if 'pending' in states else 'applied' if 'applied' in states else 'rejected'
    turn.proposal = proposal.model_dump(mode='json')
    if not decision_key and (receipt or decision.action == 'reject'):
        turn.proposal_receipt = {
            **receipts, digest: {'receipt': receipt, 'conflicts': [item.model_dump(mode='json') for item in conflicts]},
        }
    _record_decision(turn, decision, 'rejected' if decision.action == 'reject'
                     else 'partial' if receipt and conflicts else 'applied' if receipt else 'conflict')
    return CanvasAssistantProposalResult(
        proposal=proposal, receipt=receipt, conflicts=conflicts,
        canvas=await store.read(canvas.id) if receipt or conflicts else None,
    )


async def _replay_decision(store, canvas_id, proposal, recorded):
    if 'state' in recorded:
        proposal.state = recorded['state']
        for group in proposal.groups or []:
            group.state = recorded['group_states'][group.id]
    return CanvasAssistantProposalResult(
        proposal=proposal, receipt=recorded['receipt'], conflicts=recorded['conflicts'],
        canvas=await store.read(canvas_id) if recorded['receipt'] or recorded['conflicts'] else None,
        replayed=True,
    )


def _record_decision(turn, decision, outcome):
    audit = CanvasAssistantApprovalAudit(source_id=turn.request_id, mode=decision.approval_mode,
                                       action=decision.action, outcome=outcome, group_ids=decision.group_ids,
                                       decision_id=decision.decision_id)
    entry = audit.model_dump(mode='json')
    previous = turn.approval_audit or []
    if entry not in previous:
        turn.approval_audit = [*previous, entry]


async def _apply_groups(store, canvas, groups, digest):
    document = CanvasDocument.model_validate(canvas.document)
    conflicts = []
    edited = False
    for group in groups:
        candidate = document.model_copy(deep=True)
        stale = await _apply_group(store, canvas, candidate, group)
        if stale:
            conflicts.extend(stale)
            continue
        document = candidate
        group.state = 'applied'
        edited = True
    receipt = await store.save(canvas.id, CanvasSave(
        request_id='assistant:' + digest, expected_revision=canvas.revision, document=document.model_dump(mode='json'),
    )) if edited else None
    return receipt, conflicts


async def _apply_group(store, canvas, document, group):
    conflicts = []
    for change in group.edits:
        current = None
        if isinstance(change.target, (AddCanvasCardTarget, AdoptFirstFrameTarget, AdjustShotMovementTarget, ConnectCardsTarget)):
            if await apply_structural_change(store, canvas, document, change):
                continue
        elif isinstance(change.target, (DeleteCardEdit, ReleaseBindingEdit, DisconnectCardsEdit)):
            impact = removal_impact(document, change.card_id, change.target)
            if impact:
                current, fingerprint = impact
                if fingerprint == change.impact_fingerprint:
                    apply_removal(document, change.card_id, change.target)
                    continue
        else:
            card = next((item for item in document.cards if item.id == change.card_id), None)
            field = _editable_text(card, change.target)
            if field is not None:
                current = field.text
                if current == change.before:
                    _apply_text(card, field, change)
                    continue
        conflicts.append(CanvasAssistantEditConflict(
            group_id=group.id, card_id=change.card_id, target=change.target, current=current,
        ))
    return conflicts
