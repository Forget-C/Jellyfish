"""Editable queue entries serialized with the owning conversation."""

from fastapi import HTTPException
from sqlalchemy import select

from app.models.canvas_assistant import CanvasAssistantQueuedMessage
from app.schemas.canvas_assistant import CanvasAssistantQueueItem
from app.services.generation_canvas.assistant_events import publish_queue_event


def queue_item(entry: CanvasAssistantQueuedMessage) -> CanvasAssistantQueueItem:
    """Read stable queue identity, content and any assigned turn identity."""
    return CanvasAssistantQueueItem(
        request_id=entry.request_id, message={'text': entry.command['text']}, state=entry.state, turn_id=entry.turn_id,
    )


async def pending_queue(db, canvas_id: str) -> list[CanvasAssistantQueuedMessage]:
    """List in-order messages that can still be processed or resumed."""
    return list(await db.scalars(select(CanvasAssistantQueuedMessage).where(
        CanvasAssistantQueuedMessage.canvas_id == canvas_id,
        CanvasAssistantQueuedMessage.state.in_(('queued', 'admitted')),
    ).order_by(CanvasAssistantQueuedMessage.position)))


async def require_queue_entry(db, canvas_id: str, request_id: str) -> CanvasAssistantQueuedMessage:
    """Resolve a queue entry under the session lock held by the caller."""
    entry = await db.get(CanvasAssistantQueuedMessage, (canvas_id, request_id))
    if entry is None:
        raise HTTPException(404, 'Canvas assistant queue item not found')
    return entry


async def complete_queued_turn(db, session, turn_id: str) -> None:
    """Complete the admitted entry in the same transaction as its turn."""
    entry = await db.scalar(select(CanvasAssistantQueuedMessage).where(
        CanvasAssistantQueuedMessage.canvas_id == session.canvas_id,
        CanvasAssistantQueuedMessage.turn_id == turn_id,
        CanvasAssistantQueuedMessage.state == 'admitted',
    ))
    if entry is not None:
        entry.state = 'completed'
        publish_queue_event(db, session, queue_item(entry), 'queue.completed')
