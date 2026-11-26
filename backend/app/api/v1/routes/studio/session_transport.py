"""Send a turn or follow a session without client-side routing information."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.exceptions import RequestValidationError
from pydantic import SkipValidation, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.contracts.generation import GenerationSubmitRequest
from app.dependencies import get_db
from app.models.experiment_sessions import ExperimentSession
from app.models.generation_canvas import GenerationCanvas
from app.schemas.chat import ChatEvent, ChatSessionKind, ChatSessionSnapshot, ChatTurnReceipt, TrialChatHistory
from app.schemas.canvas_assistant import CanvasAssistantMessage, CanvasAssistantQuestionAnswer
from app.schemas.common import ApiResponse, error_response, success_response
from app.schemas.interaction import InteractionRequestHeader
from app.schemas.studio.lab_chat import ArtifactAnswer, LabChatCommand
from app.schemas.studio.text_lab import TextLabRunRequest
from app.services.chat import commands, laboratory
from app.services.chat.stream import session_event_stream
from app.services.generation_canvas.assistant import CanvasAssistant
from app.services.studio import text_trials
from app.services.studio.media_trials import media_event_page, media_snapshot
from app.services.studio.session_events import session_event_page

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db, scope='function')]
Answer = SkipValidation[CanvasAssistantQuestionAnswer | ArtifactAnswer]
Command = SkipValidation[CanvasAssistantMessage | LabChatCommand | TextLabRunRequest | GenerationSubmitRequest]


class SessionEventStream(StreamingResponse):
    media_type = 'text/event-stream'


async def session_owner(db, session_id):
    """Resolve the persisted session and the canvas project, if any."""
    experiment = await db.get(ExperimentSession, session_id)
    if experiment:
        return experiment.lab_type, None
    canvas = await db.get(GenerationCanvas, session_id)
    if canvas:
        return 'canvas', canvas.project_id
    raise HTTPException(404, 'Chat session not found')


async def typed_session_owner(db, kind, session_id):
    owner = await session_owner(db, session_id)
    if owner[0] != kind:
        raise HTTPException(404, 'Chat session not found')
    return owner


def command_for(schema, data):
    try:
        return schema.model_validate(data)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc


@router.post('/{session_id}/turns', operation_id='chat_session_send', response_model=ApiResponse[ChatTurnReceipt], status_code=202)
async def send_turn(session_id: str, body: Command, db: Database,
                    idempotency_key: InteractionRequestHeader = None):
    owner = await session_owner(db, session_id)
    return await _send_turn(session_id, body, db, idempotency_key, owner)


async def _send_turn(session_id, body, db, idempotency_key, owner):
    kind, _ = owner
    if kind == 'canvas' and isinstance(body, dict) and 'turns' in body:
        raise HTTPException(409, 'The draft has already been saved')
    if kind == 'text' and not idempotency_key:
        raise HTTPException(422, 'Idempotency-Key required')
    schemas = {'canvas': CanvasAssistantMessage, 'chat': LabChatCommand, 'text': TextLabRunRequest}
    command = command_for(schemas.get(kind, GenerationSubmitRequest), body)
    receipt = await commands.send(db, session_id, owner, command, idempotency_key)
    return success_response(receipt, code=202)


@router.post('/{session_id}/turns/{turn_id}/answer', operation_id='chat_session_answer',
             response_model=ApiResponse[ChatTurnReceipt], status_code=202)
async def answer_turn(session_id: str, turn_id: str, body: Answer, db: Database):
    """Admit an answer to the original paused turn and resume it independently."""
    owner = await session_owner(db, session_id)
    return await _answer_turn(session_id, turn_id, body, db, owner)


async def _answer_turn(session_id, turn_id, body, db, owner):
    kind, _ = owner
    schema = {'canvas': CanvasAssistantQuestionAnswer, 'chat': ArtifactAnswer}.get(kind)
    if schema is None:
        raise HTTPException(404, 'Chat session does not accept answers')
    receipt = await commands.answer(db, session_id, turn_id, owner, command_for(schema, body))
    return success_response(receipt, code=202)


EVENT_RESPONSES = {200: {'content': {'text/event-stream': {'itemSchema': {
    'type': 'object', 'required': ['data'], 'properties': {
        'data': {'type': 'string', 'contentMediaType': 'application/json',
                 'contentSchema': {'$ref': '#/components/schemas/ChatEvent'}}}}}}}}


@router.get('/{session_id}/events', operation_id='chat_session_events',
            response_class=SessionEventStream, response_model=ChatEvent, responses=EVENT_RESPONSES)
async def subscribe(session_id: str, db: Database, after: Annotated[int, Query(ge=0)] = 0,
                    last_event_id: Annotated[int, Header(ge=0)] = 0, follow: bool = True):
    owner = await session_owner(db, session_id)
    return await _subscribe(session_id, db, max(after, last_event_id), follow, owner)


async def _subscribe(session_id, db, cursor, follow, owner):
    kind, project = owner
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)
    await db.rollback()  # Release the lookup connection before opening a page reader.

    async def read_page(cursor):
        async with sessions() as reader:
            if kind == 'canvas':
                return await CanvasAssistant(reader, project or '').events(session_id, cursor)
            if kind in ('image', 'video'):
                return await media_event_page(reader, session_id, cursor)
            return await session_event_page(reader, session_id, cursor)

    return await session_event_stream(read_page, cursor, follow=follow)


@router.post('/{kind}/{session_id}/turns', operation_id='chat_bound_send',
             response_model=ApiResponse[ChatTurnReceipt], status_code=202)
async def send_bound_turn(kind: ChatSessionKind, session_id: str, body: Command,
                          db: Database, idempotency_key: InteractionRequestHeader = None):
    """Admit a turn in the session identified by the path."""
    owner = await typed_session_owner(db, kind, session_id)
    if kind in ('image', 'video') and not idempotency_key:
        raise HTTPException(422, 'Idempotency-Key required')
    return await _send_turn(session_id, body, db, idempotency_key, owner)


@router.get('/{kind}/{session_id}/requests/{request_id}', operation_id='chat_bound_media_receipt',
            response_model=ApiResponse[ChatTurnReceipt])
async def bound_media_receipt(kind: ChatSessionKind, session_id: str, db: Database, response: Response,
                              request_id: Annotated[str, Path(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')]):
    """Look up an accepted media request without changing its task or event history."""
    await typed_session_owner(db, kind, session_id)
    if kind not in ('image', 'video'):
        raise HTTPException(404, 'Chat session does not support media receipts')
    receipt = await commands.media_request_receipt(db, session_id, request_id)
    if receipt is None:
        return JSONResponse(status_code=404, headers={'Cache-Control': 'no-store'},
                            content=error_response(code=404, message='Laboratory interaction request not found').model_dump())
    response.headers['Cache-Control'] = 'no-store'
    return success_response(receipt)


@router.post('/{kind}/{session_id}/turns/{turn_id}/answer', operation_id='chat_bound_answer',
             response_model=ApiResponse[ChatTurnReceipt], status_code=202)
async def answer_bound_turn(kind: ChatSessionKind, session_id: str, turn_id: str, body: Answer, db: Database):
    """Admit an answer to a question in the bound session."""
    owner = await typed_session_owner(db, kind, session_id)
    return await _answer_turn(session_id, turn_id, body, db, owner)


@router.get('/{kind}/{session_id}/events', operation_id='chat_bound_events',
            response_class=SessionEventStream, response_model=ChatEvent, responses=EVENT_RESPONSES)
async def subscribe_bound(kind: ChatSessionKind, session_id: str, db: Database,
                          after: Annotated[int, Query(ge=0)] = 0,
                          last_event_id: Annotated[int, Header(ge=0)] = 0, follow: bool = True):
    """Stream committed events from a bound session."""
    owner = await typed_session_owner(db, kind, session_id)
    return await _subscribe(session_id, db, max(after, last_event_id), follow, owner)


@router.get('/{kind}/{session_id}/snapshot', operation_id='chat_bound_snapshot',
            response_model=ApiResponse[ChatSessionSnapshot])
async def bound_snapshot(kind: ChatSessionKind, session_id: str, db: Database, response: Response,
                         page: Annotated[int, Query(ge=1)] = 1,
                         page_size: Annotated[int, Query(ge=1, le=100)] = 50):
    """Return the public checkpoint and history for the bound session."""
    response.headers['Cache-Control'] = 'no-store'
    _, project = await typed_session_owner(db, kind, session_id)
    if kind in ('text', 'image', 'video'):
        read_snapshot = text_trials.snapshot if kind == 'text' else media_snapshot
        messages, checkpoint = await read_snapshot(db, session_id, page, page_size)
        return success_response(ChatSessionSnapshot(kind=kind, **checkpoint.model_dump(),
                                                     history=TrialChatHistory(messages=messages)))
    history = (await CanvasAssistant(db, project or '').history(session_id) if kind == 'canvas'
               else await laboratory.snapshot(db, session_id))
    return success_response(ChatSessionSnapshot(kind=kind, session_id=session_id,
                                                 cursor=history.cursor, capabilities=history.capabilities,
                                                 history=history))
