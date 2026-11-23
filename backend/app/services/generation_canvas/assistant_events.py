"""Append canvas assistant events atomically with their business state."""

from app.models.canvas_assistant import CanvasAssistantEvent, CanvasAssistantSession
from app.schemas.canvas_assistant import CanvasAssistantExchange, InteractionEvent


def publish_events(db, session: CanvasAssistantSession, exchange: CanvasAssistantExchange, *kinds: str) -> None:
    """Append exact exchange snapshots under the caller's session or canvas lock."""
    if not kinds:
        return
    payload = exchange.model_dump(mode='json')
    for kind in kinds:
        session.event_cursor += 1
        db.add(CanvasAssistantEvent(canvas_id=session.canvas_id, cursor=session.event_cursor,
                                    source_id=exchange.request_id, kind=kind, payload=payload))


def event_read(event: CanvasAssistantEvent) -> InteractionEvent[CanvasAssistantExchange]:
    """Return the saved event without recomputing historical decisions."""
    return InteractionEvent[CanvasAssistantExchange](
        session_id=event.canvas_id, turn_id=event.source_id, cursor=event.cursor,
        type=event.kind, payload=CanvasAssistantExchange.model_validate(event.payload),
    )
