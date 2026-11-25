"""Direct text trials using the shared conversation transport."""
import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.services.studio.experiment_messages import read_experiment_page
from app.api.v1.routes.studio.text_lab import cancel_text_lab_stream
from app.dependencies import get_db
from app.models.experiment_sessions import ExperimentSession, ExperimentSessionEvent
from app.schemas.interaction import InteractionSnapshot
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.experiment_sessions import ExperimentMessageRead
from app.schemas.studio.text_lab import TextLabRunRequest, TextLabRunStatus
from app.services.chat.stream import session_event_stream
from app.services.generation.runtime.text_chat_streaming import admit_text_interaction, stream_text_run
from app.services.studio.session_events import session_event_page

router = APIRouter()
_executions = set()


class TextTrialReceipt(BaseModel):
    """Cursor immediately preceding this accepted turn, stable across retries."""

    turn_id: str
    cursor: int


async def _require_text(db, session_id):
    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(404, "target_not_found")
    if session.lab_type != "text":
        raise HTTPException(400, "experiment_session_type_invalid")


@router.get("/{session_id}", operation_id="chat_text_snapshot", response_model=ApiResponse[list[ExperimentMessageRead]])
async def text_snapshot(session_id: str, db: AsyncSession = Depends(get_db),
                        page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    """Read existing or newly accepted trial messages in their original session."""
    await _require_text(db, session_id)
    cursor = await db.scalar(select(func.max(ExperimentSessionEvent.cursor)).where(ExperimentSessionEvent.session_id == session_id))
    snapshot = InteractionSnapshot(session_id=session_id, cursor=cursor or 0, capabilities=("snapshot", "send", "events", "stop"))
    return success_response(await read_experiment_page(db, session_id, page, page_size), meta=snapshot.model_dump())


@router.post("/{session_id}/turns", operation_id="chat_text_send", response_model=ApiResponse[TextTrialReceipt])
async def text_send(session_id: str, body: TextLabRunRequest,
                    idempotency_key: Annotated[str, Header(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")],
                    db: AsyncSession = Depends(get_db)):
    """Enroll a direct provider call; SSE subscribers do not own its lifetime."""
    result = await admit_text_interaction(db, session_id, body, idempotency_key, publish_events=True)
    cursor = await db.scalar(select(ExperimentSessionEvent.cursor).where(
        ExperimentSessionEvent.session_id == session_id, ExperimentSessionEvent.turn_id == result.task_id,
        ExperimentSessionEvent.kind == "turn.accepted"))
    if result.saved_events and getattr(result.saved_events[-1].data, "error", None) and (
        result.saved_events[-1].data.error.code == "stream_result_unknown"
    ):
        raise HTTPException(409, "TEXT_LAB_STREAM_RESULT_UNKNOWN")
    if cursor is None:
        raise HTTPException(409, "TEXT_LAB_STREAM_RESULT_UNKNOWN")
    await db.commit()
    if result.start:
        job = asyncio.create_task(stream_text_run(result.task_id))
        _executions.add(job)
        job.add_done_callback(_executions.discard)
    return success_response(TextTrialReceipt(turn_id=result.task_id, cursor=cursor - 1))


@router.get("/{session_id}/events", operation_id="chat_text_events", responses={200: {"content": {"text/event-stream": {}}}})
async def text_events(session_id: str, after: int = Query(0, ge=0), follow: bool = True,
                      last_event_id: Annotated[int, Header(ge=0)] = 0,
                      db: AsyncSession = Depends(get_db, scope="function")):
    """Replay committed text trial events in session cursor order."""
    await _require_text(db, session_id)
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)

    async def read_page(cursor):
        async with sessions() as reader:
            return await session_event_page(reader, session_id, cursor)

    return await session_event_stream(read_page, max(after, last_event_id), follow=follow)


router.post("/{session_id}/turns/{task_id}/stop", operation_id="chat_text_stop",
            response_model=ApiResponse[TextLabRunStatus])(cancel_text_lab_stream)
