"""Replay committed session events in order using short read transactions."""
import asyncio

from fastapi.responses import StreamingResponse


async def session_event_stream(read_page, after, *, follow):
    """Read the first page before sending response headers so access errors propagate."""
    first = await read_page(after)

    async def frames():
        cursor = after
        page = first
        idle_polls = 0
        while True:
            for event in page:
                cursor = event.cursor
                yield f'id: {cursor}\nevent: {event.type}\ndata: {event.model_dump_json()}\n\n'
            if not page:
                if not follow:
                    return
                idle_polls += 1
                if idle_polls % 20 == 0:
                    yield ': keep-alive\n\n'
                await asyncio.sleep(.5)
            page = await read_page(cursor)

    return StreamingResponse(frames(), media_type='text/event-stream',
                             headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
