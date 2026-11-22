"""Preview and approve the assistant's narrow, user-authorized canvas edits."""

import hashlib

from fastapi import HTTPException
from langchain_core.tools import ToolException, tool
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.canvas_assistant import CanvasAssistantTurn
from app.schemas.canvas_assistant import CanvasAssistantReadContext
from app.schemas.canvas_assistant_edit import (
    CanvasAssistantEditTarget, CanvasAssistantEditText, CanvasAssistantProposal,
    CanvasAssistantProposalDecision, CanvasAssistantProposalResult, MovementFieldEdit,
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
    """Accept at most one in-memory tool proposal, scoped to the chosen saved card."""

    def __init__(self, context: CanvasAssistantReadContext, saved_document: CanvasDocument):
        target_id, = context.target_card_ids
        self.card = next(card for card in context.cards if card['id'] == target_id)
        self.saved_card = next((card for card in saved_document.cards if card.id == target_id), None)
        self.proposal: CanvasAssistantProposal | None = None

    @property
    def available(self) -> bool:
        """Only an existing editable card can get a proposal tool."""
        return (self.card['type'] in ('model.video', 'direction.movement') and self.saved_card is not None
                and self.saved_card.type == self.card['type'])

    def tool(self):
        """Expose a preview operation with no document writes or generation."""
        @tool
        async def propose_canvas_edit(card_id: str, target: CanvasAssistantEditTarget, text: CanvasAssistantEditText) -> str:
            """Preview a clearly requested change to one existing video prompt segment or movement field."""
            if self.proposal or card_id != self.card['id']:
                raise ToolException('Only one change to the selected card may be proposed')
            card_type = type(self.saved_card)
            card = card_type.model_validate(self.card)
            previous = _editable_text(card, target)
            if previous is None or previous.text == text:
                raise ToolException('Choose an existing plain-text field and provide different text')
            self.proposal = CanvasAssistantProposal(
                card_id=card_id, card_name=CARD_TITLES[card.type], target=target, before=previous.text, after=text,
            )
            return self.proposal.model_dump_json()

        propose_canvas_edit.handle_tool_error = True
        propose_canvas_edit.handle_validation_error = True
        return propose_canvas_edit


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
    if decision.expected_revision != canvas.revision:
        raise HTTPException(409, 'Canvas revision changed before assistant approval')

    document = CanvasDocument.model_validate(canvas.document)
    card = next((item for item in document.cards if item.id == proposal.card_id), None)
    field = _editable_text(card, proposal.target)
    if field is None or field.text != proposal.before:
        raise HTTPException(409, 'Canvas assistant proposal needs a new preview')
    field.text = proposal.after
    if isinstance(proposal.target, MovementFieldEdit):
        field.authorship = 'user'
        field.extraction_context = None
        field.extraction_reason = None
    elif isinstance(card, VideoModelCard) and card.generated_prompt:
        card.generated_prompt.edit_confirmed = True
    request_id = 'assistant:' + hashlib.sha256(source_id.encode()).hexdigest()[:48]
    receipt = await store.save(canvas_id, CanvasSave(
        request_id=request_id, expected_revision=decision.expected_revision, document=document.model_dump(mode='json'),
    ))
    proposal.state = 'applied'
    turn.proposal = proposal.model_dump(mode='json')
    turn.proposal_receipt = receipt
    return CanvasAssistantProposalResult(proposal=proposal, receipt=receipt, canvas=await store.read(canvas_id))
