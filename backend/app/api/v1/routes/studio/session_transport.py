"""Send a turn or follow a session without client-side routing information."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.exceptions import RequestValidationError
from pydantic import SkipValidation, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.v1.routes.studio.lab_generation_tasks import submit_media_trial
from app.core.contracts.generation import GenerationSubmitRequest, GenerationModality
from app.dependencies import get_db
from app.models.experiment_sessions import ExperimentSession
from app.models.generation_canvas import GenerationCanvas
from app.schemas.chat import ChatEvent, ChatTurnReceipt
from app.schemas.canvas_assistant import CanvasAssistantMessage
from app.schemas.common import ApiResponse, success_response
from app.schemas.interaction import InteractionRequestHeader
from app.schemas.studio.lab_chat import LabChatCommand
from app.schemas.studio.text_lab import TextLabRunRequest
from app.services.chat import laboratory
from app.services.chat.admission import admit_turn
from app.services.chat.stream import session_event_stream
from app.services.generation_canvas.assistant import CanvasAssistant
from app.services.studio import text_trials
from app.services.studio.session_events import session_event_page, turn_replay_cursor

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db, scope='function')]
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


def command_for(schema, data):
    try:
        return schema.model_validate(data)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc


@router.post('/{session_id}/turns', operation_id='chat_session_send', response_model=ApiResponse[ChatTurnReceipt], status_code=202)
async def send_turn(session_id: str, body: Command, db: Database,
                    idempotency_key: InteractionRequestHeader = None):
    kind, project = await session_owner(db, session_id)
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
        submitted = await submit_media_trial(db, session_id, GenerationModality(kind), command, idempotency_key)
        result = submitted.data
        turn_id = idempotency_key or result.messages[-1].id
        cursor = await turn_replay_cursor(db, session_id, turn_id)
    return success_response(ChatTurnReceipt(session_id=session_id, turn_id=turn_id, cursor=cursor),
                            code=202)


@router.get('/{session_id}/events', operation_id='chat_session_events',
            response_class=SessionEventStream, response_model=ChatEvent,
            responses={200: {'content': {'text/event-stream': {'itemSchema': {
                'type': 'object', 'required': ['data'], 'properties': {
                    'data': {'type': 'string', 'contentMediaType': 'application/json',
                             'contentSchema': {'$ref': '#/components/schemas/ChatEvent'}}}}}}}})
async def subscribe(session_id: str, db: Database, after: Annotated[int, Query(ge=0)] = 0,
                    last_event_id: Annotated[int, Header(ge=0)] = 0, follow: bool = True):
    kind, project = await session_owner(db, session_id)
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)

    async def read_page(cursor):
        async with sessions() as reader:
            if kind == 'canvas':
                return await CanvasAssistant(reader, project or '').events(session_id, cursor)
            return await session_event_page(reader, session_id, cursor)

    return await session_event_stream(read_page, max(after, last_event_id), follow=follow)
