"""Restrict send-time draft context to the requested cards and adopted inputs."""

import json

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
        layout_positions={card_id: request.layout_positions[card_id] for card_id in targets
                          if card_id in request.layout_positions} if request.layout_positions is not None else None,
    )


CANVAS_PAGE_SIZE = 20


def prioritize_context_cards(context: CanvasAssistantReadContext, request: str) -> list[dict]:
    """Read explicitly named targets and their adopted sources before the rest of the canvas."""
    request = request.casefold()
    cards = {card['id']: card for card in context.cards}
    named = [card['id'] for card in context.cards if any(
        isinstance(value, str) and len(value) >= 2 and value.casefold() in request
        for value in (card['id'], card.get('name'), card.get('title'))
    )]
    priority = dict.fromkeys([*named, *(context.target_card_ids if context.scope == 'selection' else ())])
    for card_id in named:
        for binding in cards[card_id].get('input_bindings') or ():
            source_id = binding.get('source', {}).get('card_id')
            if source_id in cards:
                priority[source_id] = None
    return [cards[card_id] for card_id in dict.fromkeys([*priority, *cards])]


def context_page(context: CanvasAssistantReadContext, cards: list[dict], *, offset: int, limit: int) -> dict:
    """Expose only the indexed page and its actual identifiers to the model."""
    page = cards[offset:offset + limit]
    ids = {card['id'] for card in page}
    payload = {
        'revision': context.revision,
        'scope': context.scope,
        'target_card_ids': [card_id for card_id in context.target_card_ids if card_id in ids],
        'cards': page,
        'available_card_count': len(cards),
        'next_offset': offset + limit if offset + limit < len(cards) else None,
    }
    if context.layout_positions is not None:
        payload['layout_positions'] = {key: value.model_dump(mode='json')
                                       for key, value in context.layout_positions.items() if key in ids}
    return payload


def read_text_context_coverage(history):
    """Recover the actual text page from the checkpointed user message."""
    message = next(entry for entry in reversed(history) if entry.type == 'human')
    marker = '\n本轮画布参考数据：\n'
    candidates = [message.content] if isinstance(message.content, str) else [
        part.get('text', '') for part in message.content if isinstance(part, dict) and part.get('type') == 'text'
    ]
    evidence = next((text for text in candidates if text.startswith('当前画布支持的卡片：') and marker in text), '')
    if not evidence:
        return None
    payload, _ = json.JSONDecoder().raw_decode(evidence.split(marker, 1)[1])
    return {card['id'] for card in payload['cards']}


def read_context_coverage(messages):
    """Count actual, distinct cards returned by the read tool for this request."""
    observed = set()
    for message in messages:
        if message.type == 'tool' and message.name == 'read_canvas_context' and message.status == 'success':
            payload = json.loads(message.content)
            observed.update(card['id'] for card in payload['cards'])
    return observed
