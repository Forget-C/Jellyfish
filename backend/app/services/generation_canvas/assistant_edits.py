"""Preview and approve the assistant's narrow, user-authorized canvas edits."""

import hashlib
from typing import Annotated

from fastapi import HTTPException
from langchain_core.tools import ToolException, tool
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.canvas_assistant import CanvasAssistantTurn
from app.schemas.canvas_assistant import CanvasAssistantReadContext
from app.schemas.canvas_assistant_edit import (
    CanvasAssistantChange, CanvasAssistantEditConflict, CanvasAssistantEditGroup,
    CanvasAssistantEditTarget, CanvasAssistantEditText, CanvasAssistantProposal,
    CanvasAssistantProposalDecision, CanvasAssistantProposalResult, MovementFieldEdit, ProposedEditGroup,
)
from app.schemas.generation_canvas import CanvasDocument, CanvasSave, MovementCard, PromptText, VideoModelCard
from app.services.generation_canvas.catalog import CARD_TITLES
from app.services.generation_canvas.store import CanvasStore


def _editable_text(card, target: CanvasAssistantEditTarget):
    if isinstance(target, MovementFieldEdit) and isinstance(card, MovementCard):
        field = getattr(card.fields, target.field)
        # A structured field can own references. This operation only edits plain text.
        if field.document is None:
            return field
    elif isinstance(card, VideoModelCard) and not isinstance(target, MovementFieldEdit):
        return next((part for part in card.prompt.segments
                     if isinstance(part, PromptText) and part.id == target.segment_id), None)
    return None


class CanvasAssistantEditDraft:
    """Build one in-memory preview from the chosen saved cards."""

    def __init__(self, context: CanvasAssistantReadContext, saved_document: CanvasDocument):
        target_ids = set(context.target_card_ids)
        self.cards = {card['id']: card for card in context.cards if card['id'] in target_ids}
        self.saved_cards = {card.id: card for card in saved_document.cards if card.id in self.cards}
        self.proposal: CanvasAssistantProposal | None = None

    @property
    def available(self) -> bool:
        """Only an existing editable card can get a proposal tool."""
        return any(isinstance(card, (VideoModelCard, MovementCard)) and self.cards[card.id]['type'] == card.type
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
        async def propose_canvas_edit(card_id: str, target: CanvasAssistantEditTarget, text: CanvasAssistantEditText) -> str:
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
    if decision.expected_revision > canvas.revision:
        raise HTTPException(409, 'Canvas revision does not exist')
    if proposal.groups:
        return await _resolve_groups(store, canvas, turn, proposal, decision)
    if decision.group_ids is not None:
        raise HTTPException(422, 'This assistant proposal has no edit groups')
    if proposal.state == 'applied' and decision.action == 'approve':
        return CanvasAssistantProposalResult(proposal=proposal, receipt=turn.proposal_receipt,
                                             canvas=await store.read(canvas_id))
    if proposal.state == 'rejected' and decision.action == 'reject':
        return CanvasAssistantProposalResult(proposal=proposal)
    if proposal.state != 'pending':
        raise HTTPException(409, 'Canvas assistant proposal has already been decided')
    if decision.action == 'reject':
        proposal.state = 'rejected'
        turn.proposal = proposal.model_dump(mode='json')
        return CanvasAssistantProposalResult(proposal=proposal)

    document = CanvasDocument.model_validate(canvas.document)
    card = next((item for item in document.cards if item.id == proposal.card_id), None)
    field = _editable_text(card, proposal.target)
    if field is None or field.text != proposal.before:
        raise HTTPException(409, 'Canvas assistant proposal needs a new preview')
    _apply_text(card, field, proposal)
    request_id = 'assistant:' + hashlib.sha256(source_id.encode()).hexdigest()[:48]
    receipt = await store.save(canvas_id, CanvasSave(
        request_id=request_id, expected_revision=canvas.revision, document=document.model_dump(mode='json'),
    ))
    proposal.state = 'applied'
    turn.proposal = proposal.model_dump(mode='json')
    turn.proposal_receipt = receipt
    return CanvasAssistantProposalResult(proposal=proposal, receipt=receipt, canvas=await store.read(canvas_id))


def _apply_text(card, field, change: CanvasAssistantChange) -> None:
    field.text = change.after
    if isinstance(change.target, MovementFieldEdit):
        field.authorship = 'user'
        field.extraction_context = None
        field.extraction_reason = None
    elif isinstance(card, VideoModelCard) and card.generated_prompt:
        card.generated_prompt.edit_confirmed = True


async def _resolve_groups(store, canvas, turn, proposal, decision) -> CanvasAssistantProposalResult:
    groups = {group.id: group for group in proposal.groups}
    if decision.group_ids is None:
        raise HTTPException(422, 'Select the assistant edit groups to decide')
    selected = sorted(decision.group_ids)
    if len(set(selected)) != len(selected) or any(group_id not in groups for group_id in selected):
        raise HTTPException(422, 'Unknown or repeated assistant edit group')
    digest = hashlib.sha256(':'.join((turn.request_id, decision.action, *selected)).encode()).hexdigest()[:48]
    receipts = turn.proposal_receipt or {}
    recorded = receipts.get(digest)
    if recorded:
        return CanvasAssistantProposalResult(
            proposal=proposal, receipt=recorded['receipt'], conflicts=recorded['conflicts'],
            canvas=await store.read(canvas.id) if recorded['receipt'] else None,
        )
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
    if receipt or decision.action == 'reject':
        turn.proposal_receipt = {
            **receipts, digest: {'receipt': receipt, 'conflicts': [item.model_dump(mode='json') for item in conflicts]},
        }
    return CanvasAssistantProposalResult(
        proposal=proposal, receipt=receipt, conflicts=conflicts,
        canvas=await store.read(canvas.id) if receipt or conflicts else None,
    )


async def _apply_groups(store, canvas, groups, digest):
    document = CanvasDocument.model_validate(canvas.document)
    cards = {card.id: card for card in document.cards}
    conflicts = []
    edited = False
    for group in groups:
        writes = []
        stale = []
        for change in group.edits:
            card = cards.get(change.card_id)
            field = _editable_text(card, change.target)
            if field is None or field.text != change.before:
                stale.append(CanvasAssistantEditConflict(
                    group_id=group.id, card_id=change.card_id, target=change.target,
                    current=field.text if field is not None else None,
                ))
            else:
                writes.append((card, field, change))
        if stale:
            conflicts.extend(stale)
            continue
        for card, field, change in writes:
            _apply_text(card, field, change)
        group.state = 'applied'
        edited = True
    receipt = await store.save(canvas.id, CanvasSave(
        request_id='assistant:' + digest, expected_revision=canvas.revision, document=document.model_dump(mode='json'),
    )) if edited else None
    return receipt, conflicts
