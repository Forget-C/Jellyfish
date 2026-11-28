"""Persistent event replay uses fresh short transactions, including on MySQL RR."""
import asyncio
import json
from app.services.generation_canvas.runs import canvas_runs


def encode(event):
    """SSE id is the committed canvas cursor, independent of HTTP chunk boundaries."""
    return f"id: {event['cursor']}\nevent: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


async def stream_events(sessions, project_id, canvas_id, cursor=None):
    """Snapshots and replay share the writer head lock; no lock survives a yield."""
    while True:
        async with sessions() as db:
            events = await canvas_runs(db, project_id).read_events(canvas_id, cursor)
            await db.commit()
        for event in events:
            cursor = event.cursor
            yield encode(event.model_dump(mode='json'))
        if not events:
            yield ': keep-alive\n\n'
            await asyncio.sleep(0.25)
