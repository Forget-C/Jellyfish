"""Restrict send-time draft context to the requested cards and adopted inputs."""

from fastapi import HTTPException
from pydantic import ValidationError

from app.models.generation_canvas import GenerationCanvas
from app.schemas.canvas_assistant import CanvasAssistantDraftContext, CanvasAssistantReadContext
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.allowed_cards import validate_canvas_cards


def resolve_assistant_context(canvas: GenerationCanvas, request: CanvasAssistantDraftContext) -> CanvasAssistantReadContext:
    """Read the local snapshot without modifying or resolving any other canvas."""
    try:
        draft = CanvasDocument.model_validate(request.draft)
    except ValidationError as exc:
        raise HTTPException(422, 'Invalid canvas assistant draft context') from exc
    if draft.id != canvas.id or (draft.project_id or None) != canvas.project_id or request.revision > canvas.revision:
        raise HTTPException(422, 'Canvas assistant context does not match this canvas')
    validate_canvas_cards(canvas, draft)
    cards = {card.id: card for card in draft.cards}
    targets = list(cards) if request.scope == 'canvas' else list(dict.fromkeys(request.card_ids))
    if len(cards) != len(draft.cards) or any(card_id not in cards for card_id in targets):
        raise HTTPException(422, 'Canvas assistant context contains an invalid target')

    adopted = dict.fromkeys(targets)
    pending = list(targets)
    while pending:
        card = cards[pending.pop()]
        for binding in getattr(card, 'input_bindings', ()):
            source = binding.source
            if source.canvas_id == canvas.id and source.card_id in cards and source.card_id not in adopted:
                adopted[source.card_id] = None
                pending.append(source.card_id)
    return CanvasAssistantReadContext(
        revision=request.revision, scope=request.scope, target_card_ids=targets,
        cards=[cards[card_id].model_dump(mode='json') for card_id in adopted],
    )
