"""Public session operations for the canvas chat profile."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.v1.routes.studio import generation_canvases as canvas_routes
from app.dependencies import get_db
from app.schemas.canvas_assistant import CanvasAssistantExchange, CanvasAssistantHistory, CanvasAssistantMessage
from app.schemas.canvas_assistant_draft import DraftAssistantReply
from app.services.generation_canvas.assistant_draft import draft_reply_events
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


# Share the existing canvas authorization, approval and execution receipts.
router.add_api_route('/canvas/{canvas_id}/turns/{source_id}/answer', canvas_routes.answer_assistant_question,
                     methods=['POST'], response_model=ApiResponse[CanvasAssistantExchange], operation_id='chat_canvas_answer')
router.add_api_route('/canvas/{canvas_id}/turns/{source_id}/stop', canvas_routes.stop_assistant_turn,
                     methods=['POST'], response_model=ApiResponse[CanvasAssistantExchange], operation_id='chat_canvas_stop')
router.add_api_route('/canvas/{canvas_id}/proposals/{source_id}', canvas_routes.decide_assistant_proposal,
                     methods=['POST'], response_model=ApiResponse[canvas_routes.CanvasAssistantProposalResult], operation_id='chat_canvas_decide')
router.add_api_route('/canvas/{canvas_id}/layout/{source_id}', canvas_routes.decide_layout,
                     methods=['POST'], response_model=ApiResponse[canvas_routes.CanvasAssistantLayout], operation_id='chat_canvas_layout')
router.add_api_route('/canvas/{canvas_id}/generations/{source_id}/approval', canvas_routes.reapprove_canvas_generation,
                     methods=['POST'], response_model=ApiResponse[canvas_routes.CanvasAssistantGenerationRead], operation_id='chat_canvas_generation')

router.add_api_route('/draft/{canvas_id}/turns', canvas_routes.send_draft_assistant_message, methods=['POST'],
                     response_model=ApiResponse[CanvasAssistantExchange], operation_id='chat_draft_send')
router.add_api_route('/draft/{canvas_id}/turns/{source_id}', canvas_routes.read_draft_reply, methods=['GET'],
                     response_model=ApiResponse[DraftAssistantReply], operation_id='chat_draft_snapshot')
router.add_api_route('/draft/{canvas_id}/turns/{source_id}/stop', canvas_routes.stop_draft_reply, methods=['POST'],
                     response_model=ApiResponse[DraftAssistantReply], operation_id='chat_draft_stop')


@router.get('/draft/{canvas_id}/turns/{source_id}/events', operation_id='chat_draft_events',
            responses={200: {'content': {'text/event-stream': {}}}})
async def draft_events(canvas_id: UUID, source_id: str, after: Annotated[int, Query(ge=0)] = 0, follow: bool = True,
                       last_event_id: Annotated[int, Header(ge=0)] = 0):
    """Subscribe to an unsaved draft without creating a canvas."""
    async def read_page(cursor):
        return draft_reply_events(str(canvas_id), source_id, cursor)
    return await session_event_stream(read_page, max(after, last_event_id), follow=follow)
