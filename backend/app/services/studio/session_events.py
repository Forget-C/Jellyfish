"""Serialize public experiment events with their business transaction."""
from sqlalchemy import select, update

from app.models.experiment_sessions import ExperimentSession, ExperimentSessionEvent
from app.schemas.interaction import InteractionEvent


def _read(row):
    return InteractionEvent(session_id=row.session_id, turn_id=row.turn_id, cursor=row.cursor,
                            type=row.kind, payload=row.payload)


async def append_session_event(db, session_id, turn_id, kind, payload):
    """Serialize writers in one session so a cursor cannot skip an uncommitted event."""
    await db.execute(update(ExperimentSession).where(ExperimentSession.id == session_id)
                     .values(updated_at=ExperimentSession.updated_at))
    event = ExperimentSessionEvent(session_id=session_id, turn_id=turn_id, kind=kind, payload=payload)
    db.add(event)
    await db.flush()
    return _read(event)


async def session_event_page(db, session_id, after):
    """Read the next committed page. The caller validates the session's profile."""
    rows = await db.scalars(select(ExperimentSessionEvent).where(
        ExperimentSessionEvent.session_id == session_id, ExperimentSessionEvent.cursor > after,
    ).order_by(ExperimentSessionEvent.cursor).limit(100))
    return [_read(row) for row in rows]
