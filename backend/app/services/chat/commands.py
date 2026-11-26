"""Use one admission and replay implementation for bound and compatibility chat routes."""
from fastapi import HTTPException

from app.core.contracts.generation import GenerationModality
from app.schemas.chat import ChatTurnReceipt
from app.services.chat import laboratory
from app.services.chat.admission import admit_turn
from app.services.generation_canvas.assistant import CanvasAssistant
from app.services.studio import text_trials
from app.services.studio.media_trials import submit_media_trial
from app.services.studio.session_events import turn_replay_cursor


async def send(db, session_id, owner, command, idempotency_key):
    """Return the committed receipt while leaving any admitted execution detached."""
    kind, project = owner
    if kind == 'canvas':
        turn_id = command.request_id
        await db.rollback()
        cursor = await admit_turn(db.bind, lambda worker_db, accept: CanvasAssistant(worker_db, project or '').send(
            session_id, command, on_accepted=accept))
        if cursor is None:
            cursor = await CanvasAssistant(db, project or '').turn_replay_cursor(session_id, turn_id)
    elif kind == 'chat':
        turn_id = command.request_id
        await db.rollback()
        await admit_turn(db.bind, lambda worker_db, accept: laboratory.send(
            worker_db, session_id, command, on_accepted=accept))
        cursor = await turn_replay_cursor(db, session_id, turn_id)
    elif kind == 'text':
        receipt = await text_trials.send(db, session_id, command, idempotency_key)
        turn_id, cursor = receipt.turn_id, receipt.cursor
    else:
        result = await submit_media_trial(db, session_id, GenerationModality(kind), command, idempotency_key)
        turn_id = idempotency_key or result.messages[-1].id
        cursor = await turn_replay_cursor(db, session_id, turn_id)
    return ChatTurnReceipt(session_id=session_id, turn_id=turn_id, cursor=cursor)


async def answer(db, session_id, turn_id, owner, command):
    """Continue the original paused turn or recover that answer's admission."""
    kind, project = owner
    await db.rollback()
    if kind == 'canvas':
        cursor = await admit_turn(db.bind, lambda worker_db, accept: CanvasAssistant(worker_db, project or '').answer(
            session_id, turn_id, command, on_accepted=accept))
        if cursor is None:
            cursor = await CanvasAssistant(db, project or '').answer_replay_cursor(session_id, turn_id, command)
    elif kind == 'chat':
        cursor = await admit_turn(db.bind, lambda worker_db, accept: laboratory.answer_turn(
            worker_db, session_id, turn_id, command, on_accepted=accept))
    else:
        raise HTTPException(404, 'Chat session does not accept answers')
    return ChatTurnReceipt(session_id=session_id, turn_id=turn_id, cursor=cursor)
