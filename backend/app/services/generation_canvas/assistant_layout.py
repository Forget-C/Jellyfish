"""Validate layout advice against the locked canvas and retain its execution state."""

from typing import Annotated
from uuid import uuid4

from fastapi import HTTPException
from langchain_core.tools import ToolException, tool
from pydantic import Field, StringConstraints

from app.models.canvas_assistant import CanvasAssistantSession, CanvasAssistantTurn
from app.schemas.canvas_assistant_layout import (
    CanvasAssistantGrouping, CanvasAssistantLayout, CanvasAssistantPlacement, CardId, MoveCanvasCards,
)
from app.schemas.canvas_assistant import CanvasAssistantExchange
from app.services.generation_canvas.assistant_events import publish_events
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.store import CanvasStore


class CanvasAssistantLayoutDraft:
    """Build at most one arrangement using positioned cards from the request scope."""

    def __init__(self, context, visible_document):
        self.positions = context.layout_positions or {}
        self.memberships = {member: group.id for group in visible_document.groups for member in group.card_ids}
        self.proposal: CanvasAssistantLayout | None = None

    def tool(self):
        @tool
        def propose_canvas_layout(
            card_ids: Annotated[list[CardId], Field(min_length=1, max_length=100)],
            group_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)] | None = None,
            placement: CanvasAssistantPlacement | None = None,
        ) -> str:
            """Preview a new group, absolute card moves, or browser arrangement for positioned cards in scope."""
            chosen = set(card_ids)
            if self.proposal or len(chosen) != len(card_ids) or not chosen.issubset(self.positions):
                raise ToolException('Choose distinct positioned cards in the locked canvas scope')
            if not group_name and placement is None:
                raise ToolException('Choose grouping, a move, or arrangement')
            if group_name and (len(chosen) < 2 or chosen.intersection(self.memberships)):
                raise ToolException('Choose at least two ungrouped cards to create a group')
            if isinstance(placement, MoveCanvasCards) and set(placement.positions) != chosen:
                raise ToolException('Provide one destination for each chosen card')
            self.proposal = CanvasAssistantLayout(
                before={card_id: self.positions[card_id] for card_id in card_ids},
                group_membership={card_id: self.memberships.get(card_id) for card_id in card_ids},
                placement=placement,
                group=CanvasAssistantGrouping(id=uuid4().hex, name=group_name, card_ids=card_ids) if group_name else None,
            )
            return self.proposal.model_dump_json()

        propose_canvas_layout.handle_tool_error = True
        propose_canvas_layout.handle_validation_error = True
        return propose_canvas_layout


async def decide_assistant_layout(db, project_id, canvas_id, source_id, action) -> CanvasAssistantLayout:
    """Persist approval separately from a browser's idempotent layout acknowledgement."""
    canvas = await CanvasStore(db, project_id).get(canvas_id, lock=True)
    turn = await db.get(CanvasAssistantTurn, (canvas_id, source_id), with_for_update=True, populate_existing=True)
    if turn is None or turn.layout is None:
        raise HTTPException(404, 'Canvas assistant layout proposal not found')
    result = CanvasAssistantLayout.model_validate(turn.layout)
    expected, target = {
        'approve': ('proposed', 'waiting'), 'reject': ('proposed', 'rejected'),
        'claim': ('waiting', 'executing'),
        'applied': ('executing', 'applied'), 'stale': ('executing', 'stale'),
    }[action]
    if result.state == target or action == 'approve' and result.state in ('executing', 'applied', 'stale'):
        return result
    if result.state != expected:
        raise HTTPException(409, 'Canvas assistant layout has already been decided')
    document = CanvasDocument.model_validate(canvas.document)
    if action == 'applied':
        if set(result.before) - {card.id for card in document.cards}:
            target = 'stale'
        elif result.group and not any(
            group.id == result.group.id and group.name == result.group.name and group.card_ids == result.group.card_ids
            for group in document.groups
        ):
            raise HTTPException(409, 'Canvas assistant group has not been saved')
    result.state = target
    turn.layout = result.model_dump(mode='json')
    session = await db.get(CanvasAssistantSession, canvas_id, with_for_update=True, populate_existing=True)
    if session:
        kind = {'applied': 'execution.succeeded', 'stale': 'execution.blocked', 'waiting': 'approval.decided',
                'rejected': 'approval.decided'}.get(target, 'layout.updated')
        publish_events(db, session, CanvasAssistantExchange.model_validate(turn), kind, subject='layout')
    return result
