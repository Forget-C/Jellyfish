"""Send a turn or follow a session without client-side routing information."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.exceptions import RequestValidationError
from pydantic import SkipValidation, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.contracts.generation import GenerationSubmitRequest, GenerationModality
from app.dependencies import get_db
from app.models.experiment_sessions import ExperimentSession
from app.models.generation_canvas import GenerationCanvas
from app.schemas.chat import ChatEvent, ChatSessionKind, ChatSessionSnapshot, ChatTurnReceipt, TrialChatHistory
from app.schemas.canvas_assistant import CanvasAssistantMessage, CanvasAssistantQuestionAnswer
from app.schemas.common import ApiResponse, success_response
from app.schemas.interaction import InteractionRequestHeader
from app.schemas.studio.lab_chat import ArtifactAnswer, LabChatCommand
from app.schemas.studio.text_lab import TextLabRunRequest
from app.services.chat import laboratory
from app.services.chat.admission import admit_turn
from app.services.chat.stream import session_event_stream
from app.services.generation_canvas.assistant import CanvasAssistant
from app.services.studio import text_trials
from app.services.studio.media_trials import media_event_page, media_snapshot, submit_media_trial
from app.services.studio.session_events import session_event_page, turn_replay_cursor

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
    kind, project = owner
    if kind == 'canvas':
        if isinstance(body, dict) and 'turns' in body:
            raise HTTPException(409, 'The draft has already been saved')
        command = command_for(CanvasAssistantMessage, body)
        turn_id = command.request_id
        await db.rollback()
        cursor = await admit_turn(db.bind, lambda worker_db, accept: CanvasAssistant(worker_db, project or '').send(
            session_id, command, on_accepted=accept))
        if cursor is None:
            cursor = await CanvasAssistant(db, project or '').turn_replay_cursor(session_id, turn_id)
    elif kind == 'chat':
        command = command_for(LabChatCommand, body)
        turn_id = command.request_id
        await db.rollback()
        await admit_turn(db.bind, lambda worker_db, accept: laboratory.send(
            worker_db, session_id, command, on_accepted=accept))
        cursor = await turn_replay_cursor(db, session_id, turn_id)
    elif kind == 'text':
        if not idempotency_key:
            raise HTTPException(422, 'Idempotency-Key required')
        accepted = await text_trials.send(db, session_id, command_for(TextLabRunRequest, body), idempotency_key)
        turn_id, cursor = accepted.turn_id, accepted.cursor
    else:
        command = command_for(GenerationSubmitRequest, body)
        result = await submit_media_trial(db, session_id, GenerationModality(kind), command, idempotency_key)
        turn_id = idempotency_key or result.messages[-1].id
        cursor = await turn_replay_cursor(db, session_id, turn_id)
    return success_response(ChatTurnReceipt(session_id=session_id, turn_id=turn_id, cursor=cursor),
                            code=202)


@router.post('/{session_id}/turns/{turn_id}/answer', operation_id='chat_session_answer',
             response_model=ApiResponse[ChatTurnReceipt], status_code=202)
async def answer_turn(session_id: str, turn_id: str, body: Answer, db: Database):
    """Admit an answer to the original paused turn and resume it independently."""
    owner = await session_owner(db, session_id)
    return await _answer_turn(session_id, turn_id, body, db, owner)


async def _answer_turn(session_id, turn_id, body, db, owner):
    kind, project = owner
    await db.rollback()
    if kind == 'canvas':
        command = command_for(CanvasAssistantQuestionAnswer, body)
        cursor = await admit_turn(db.bind, lambda worker_db, accept: CanvasAssistant(worker_db, project or '').answer(
            session_id, turn_id, command, on_accepted=accept))
        if cursor is None:
            cursor = await CanvasAssistant(db, project or '').answer_replay_cursor(session_id, turn_id, command)
    elif kind == 'chat':
        command = command_for(ArtifactAnswer, body)
        cursor = await admit_turn(db.bind, lambda worker_db, accept: laboratory.answer_turn(
            worker_db, session_id, turn_id, command, on_accepted=accept))
    else:
        raise HTTPException(404, 'Chat session does not accept answers')
    return success_response(ChatTurnReceipt(session_id=session_id, turn_id=turn_id, cursor=cursor), code=202)


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
async def bound_snapshot(kind: ChatSessionKind, session_id: str, db: Database,
                         page: Annotated[int, Query(ge=1)] = 1,
                         page_size: Annotated[int, Query(ge=1, le=100)] = 50):
    """Return the public checkpoint and history for the bound session."""
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
