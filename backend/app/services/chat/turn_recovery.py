"""A leased, durable model-step journal for the active laboratory tool loop."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, UTC
from uuid import uuid4

from langchain.agents.middleware import ModelResponse
from langchain_core.messages import AIMessage
from sqlalchemy import select, update

from app.models.experiment_sessions import ExperimentSession


def now():
    return datetime.now(UTC).replace(tzinfo=None)


def lease_end():
    return now() + timedelta(seconds=60)


def new_execution():
    return {'owner': uuid4().hex, 'steps': []}


async def claim(db, session_id, turn_id, *, paused=False):
    """Acquire an abandoned execution. A paused question is claimed only by its answer."""
    session = await db.get(ExperimentSession, session_id, with_for_update=True, populate_existing=True)
    if not session or session.active_turn != turn_id or not session.chat_execution:
        return None
    deadline = session.chat_lease_until
    if not (paused if deadline is None else deadline <= now()):
        return None
    owner = uuid4().hex
    acquired = await db.execute(update(ExperimentSession).where(
        ExperimentSession.id == session_id, ExperimentSession.active_turn == turn_id,
        ExperimentSession.chat_lease_until == deadline,
    ).values(chat_execution={**session.chat_execution, 'owner': owner}, chat_lease_until=lease_end()))
    await db.commit()
    return owner if acquired.rowcount else None


class ModelSteps:
    """Checkpoint each actual model decision before any associated tool can run."""

    def __init__(self):
        self.position = 0

    async def invoke(self, media, request, handler):
        async with media.sessions.begin() as db:
            session = await media.require_active(db)
            steps = session.chat_execution['steps']
            if self.position < len(steps):
                saved = steps[self.position]
                self.position += 1
                return ModelResponse(result=[AIMessage(**saved)])
        response = await handler(request)
        if response.result and isinstance(response.result[-1], AIMessage) and response.result[-1].tool_calls:
            message = response.result[-1]
            async with media.sessions.begin() as db:
                session = await media.require_active(db)
                state = session.chat_execution
                session.chat_execution = {**state, 'steps': [*state['steps'], {
                    'content': message.content, 'tool_calls': message.tool_calls,
                    'response_metadata': {key: value for key, value in message.response_metadata.items()
                                          if key == 'id'},
                }]}
            self.position += 1
        return response


@asynccontextmanager
async def heartbeat(sessions, session_id, turn_id, owner):
    """Renew across long-running model I/O, releasing promptly if the request is cancelled."""
    async def renew():
        while True:
            await asyncio.sleep(15)
            async with sessions.begin() as db:
                result = await db.execute(update(ExperimentSession).where(
                    ExperimentSession.id == session_id, ExperimentSession.active_turn == turn_id,
                    ExperimentSession.chat_execution['owner'].as_string() == owner,
                ).values(chat_lease_until=lease_end()))
                if not result.rowcount:
                    return

    task = asyncio.create_task(renew())
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def abandoned(sessions):
    """List expired executions; competing workers arbitrate by conditional claim."""
    async with sessions() as db:
        return (await db.execute(select(ExperimentSession.id, ExperimentSession.active_turn).where(
            ExperimentSession.active_turn.is_not(None), ExperimentSession.chat_lease_until <= now(),
        ).order_by(ExperimentSession.chat_lease_until).limit(8))).all()
