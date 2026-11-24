"""Append canvas assistant events atomically with their business state."""

from datetime import UTC, datetime

from app.models.canvas_assistant import CanvasAssistantEvent, CanvasAssistantSession
from app.schemas.interaction import InteractionEvent
from app.schemas.canvas_assistant import CanvasAssistantEventPayload, CanvasAssistantExchange, CanvasAssistantQueueItem


def publish_events(db, session: CanvasAssistantSession, exchange: CanvasAssistantExchange, *kinds: str,
                   subject: str | None = None, group_ids: list[str] | None = None) -> None:
    """Append exact exchange snapshots under the caller's session or canvas lock."""
    if not kinds:
        return
    payload = exchange.model_dump(mode='json')
    if not subject and kinds and all(kind in ('proposal.created', 'proposal.superseded') for kind in kinds):
        subject = 'edit'
        group_ids = [group.id for group in exchange.proposal.groups or []] if exchange.proposal else None
    if subject:
        payload['_event'] = {'subject': subject, 'group_ids': group_ids, 'target_version': exchange.request_id}
    for kind in kinds:
        _publish(db, session, exchange.request_id, kind, payload)


def publish_queue_event(db, session, item: CanvasAssistantQueueItem, kind: str) -> None:
    """Record the transition without conflating queue and turn identities."""
    _publish(db, session, item.request_id, kind, item.model_dump(mode='json'))


def _publish(db, session, source_id, kind, payload):
    session.event_cursor += 1
    db.add(CanvasAssistantEvent(canvas_id=session.canvas_id, cursor=session.event_cursor,
                                source_id=source_id, kind=kind, payload=payload, created_at=datetime.now(UTC).replace(tzinfo=None)))


def event_read(event: CanvasAssistantEvent) -> InteractionEvent[CanvasAssistantEventPayload]:
    """Return the saved event without recomputing historical decisions."""
    payload = (CanvasAssistantQueueItem.model_validate(event.payload) if event.kind.startswith('queue.')
               else CanvasAssistantExchange.model_validate(event.payload))
    return InteractionEvent[CanvasAssistantEventPayload](
        session_id=event.canvas_id, turn_id=payload.turn_id if isinstance(payload, CanvasAssistantQueueItem) else event.source_id,
        cursor=event.cursor, type=event.kind, payload=payload, **event.payload.get('_event', {}),
        occurred_at=event.created_at.replace(tzinfo=UTC) if event.created_at else None,
    )
