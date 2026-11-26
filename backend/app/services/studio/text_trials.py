"""Admission, recovery and history of direct text trials."""
import asyncio

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update

from app.core.contracts.streaming import StreamEventType
from app.models.experiment_sessions import ExperimentSession, ExperimentSessionEvent
from app.schemas.interaction import InteractionSnapshot
from app.services.generation.runtime.text_chat_streaming import active_text_run_ids, admit_text_interaction, stream_text_run
from app.services.studio.experiment_messages import read_experiment_page
from app.services.studio.session_events import append_session_event

_executions = set()


class TextTrialReceipt(BaseModel):
    """Cursor immediately preceding this accepted turn, stable across retries."""

    turn_id: str
    cursor: int


async def require_text(db, session_id):
    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(404, "target_not_found")
    if session.lab_type != "text":
        raise HTTPException(400, "experiment_session_type_invalid")


async def snapshot(db, session_id, page, page_size):
    """Hold the session writer lock while reading the history and its event cursor."""
    if db.get_bind().dialect.name == 'sqlite':
        await db.execute(update(ExperimentSession).where(ExperimentSession.id == session_id)
                         .values(updated_at=ExperimentSession.updated_at))
    await db.get(ExperimentSession, session_id, with_for_update=True)
    await require_text(db, session_id)
    cursor = await db.scalar(select(func.max(ExperimentSessionEvent.cursor)).where(ExperimentSessionEvent.session_id == session_id))
    snapshot = InteractionSnapshot(session_id=session_id, cursor=cursor or 0, capabilities=("snapshot", "send", "events", "stop"))
    return await read_experiment_page(db, session_id, page, page_size), snapshot


async def snapshot_active_turn_ids(db, session_id):
    active = await active_text_run_ids(session_id)
    if not active:
        return []
    finished = set(await db.scalars(select(ExperimentSessionEvent.turn_id).where(
        ExperimentSessionEvent.session_id == session_id, ExperimentSessionEvent.turn_id.in_(active),
        ExperimentSessionEvent.kind.in_(('turn.completed', 'turn.failed', 'turn.stopped')),
    )))
    return [turn_id for turn_id in active if turn_id not in finished]


async def _restore_accepted_events(db, session_id, task_id, saved_events):
    """Publish a terminal legacy text run using the durable messages already on record."""
    kinds = {
        StreamEventType.accepted: 'turn.accepted',
        StreamEventType.delta: 'message.updated',
        StreamEventType.completed: 'turn.completed',
        StreamEventType.error: 'turn.failed',
        StreamEventType.cancelled: 'turn.stopped',
    }
    accepted = None
    for event in saved_events:
        committed = await append_session_event(
            db, session_id, task_id, kinds[event.event], event.data.model_dump(mode='json'))
        if event.event == StreamEventType.accepted:
            accepted = committed.cursor
    return accepted


async def send(db, session_id, body, idempotency_key):
    result = await admit_text_interaction(db, session_id, body, idempotency_key)
    cursor = await db.scalar(select(ExperimentSessionEvent.cursor).where(
        ExperimentSessionEvent.session_id == session_id, ExperimentSessionEvent.turn_id == result.task_id,
        ExperimentSessionEvent.kind == "turn.accepted"))
    if cursor is None and result.saved_events and getattr(result.saved_events[-1].data, "error", None) and (
        result.saved_events[-1].data.error.code == "stream_result_unknown"
    ):
        raise HTTPException(409, "TEXT_LAB_STREAM_RESULT_UNKNOWN")
    if cursor is None and result.saved_events:
        cursor = await _restore_accepted_events(db, session_id, result.task_id, result.saved_events)
    if cursor is None:
        raise HTTPException(409, "TEXT_LAB_STREAM_RESULT_UNKNOWN")
    await db.commit()
    if result.start:
        job = asyncio.create_task(stream_text_run(result.task_id))
        _executions.add(job)
        job.add_done_callback(_executions.discard)
    return TextTrialReceipt(turn_id=result.task_id, cursor=cursor - 1)
