"""Public session operations for the canvas chat profile."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.dependencies import get_db
from app.schemas.canvas_assistant import CanvasAssistantExchange, CanvasAssistantHistory, CanvasAssistantMessage
from app.schemas.common import ApiResponse, success_response
from app.services.chat.stream import session_event_stream
from app.services.generation_canvas.assistant import CanvasAssistant

router = APIRouter()


@router.get('/canvas/{canvas_id}', response_model=ApiResponse[CanvasAssistantHistory], operation_id='chat_canvas_snapshot')
async def canvas_snapshot(canvas_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """Open the canvas conversation at its latest committed cursor."""
    return success_response(await CanvasAssistant(db, project_id).history(canvas_id))


@router.post('/canvas/{canvas_id}/turns', response_model=ApiResponse[CanvasAssistantExchange], operation_id='chat_canvas_send')
async def canvas_send(canvas_id: str, body: CanvasAssistantMessage, project_id: str = '',
                      db: AsyncSession = Depends(get_db, scope='function')):
    """Accept a turn or return its existing receipt on retry."""
    return success_response(await CanvasAssistant(db, project_id).send(canvas_id, body))


@router.get('/canvas/{canvas_id}/events', operation_id='chat_canvas_events',
            responses={200: {'content': {'text/event-stream': {}}}})
async def canvas_events(canvas_id: str, after: Annotated[int, Query(ge=0)] = 0, follow: bool = True,
                        last_event_id: Annotated[int, Header(ge=0)] = 0, project_id: str = '',
                        db: AsyncSession = Depends(get_db, scope='function')):
    """Subscribe or replay committed updates from a client cursor."""
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)

    async def read_page(cursor):
        async with sessions() as session:
            return await CanvasAssistant(session, project_id).events(canvas_id, cursor)

    return await session_event_stream(read_page, max(after, last_event_id), follow=follow)
