"""Persistent event replay uses fresh short transactions, including on MySQL RR."""
import asyncio
import json
from sqlalchemy import select
from app.models.generation_canvas import CanvasEvent
from app.services.generation_canvas.runtime import CanvasRuntime
from app.services.generation_canvas.events import event_head


def encode(event):
    """SSE id is the committed canvas cursor, independent of HTTP chunk boundaries."""
    return f"id: {event['cursor']}\nevent: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


async def stream_events(sessions, project_id, canvas_id, cursor=None):
    """Snapshots and replay share the writer head lock; no lock survives a yield."""
    while True:
        async with sessions() as db:
            head = await event_head(db, canvas_id)
            oldest = await db.scalar(select(CanvasEvent.cursor).where(CanvasEvent.canvas_id == canvas_id).order_by(CanvasEvent.cursor).limit(1))
            if cursor is None or cursor > head.cursor or cursor < 0 or (oldest is not None and cursor < oldest - 1) or (oldest is None and cursor < head.cursor):
                snapshot = await CanvasRuntime(db, project_id).snapshot(canvas_id)
                events = [{'version': 1, 'cursor': snapshot.cursor, 'type': 'snapshot', 'canvas_id': canvas_id,
                           'run_id': None, 'node_id': None, 'payload': snapshot.model_dump()}]
            else:
                events = list(await db.scalars(select(CanvasEvent.envelope).where(
                    CanvasEvent.canvas_id == canvas_id, CanvasEvent.cursor > cursor).order_by(CanvasEvent.cursor).limit(100)))
            await db.commit()
        for event in events:
            cursor = event['cursor']
            yield encode(event)
        if not events:
            yield ': keep-alive\n\n'
            await asyncio.sleep(0.25)
