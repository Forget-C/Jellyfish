"""Direct text trials using the shared conversation transport."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.v1.routes.studio.text_lab import cancel_text_lab_stream
from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.experiment_sessions import ExperimentMessageRead
from app.schemas.studio.text_lab import TextLabRunRequest, TextLabRunStatus
from app.services.chat.stream import session_event_stream
from app.services.studio import text_trials as trials
from app.services.studio.session_events import session_event_page

router = APIRouter()
@router.get("/{session_id}", operation_id="chat_text_snapshot", response_model=ApiResponse[list[ExperimentMessageRead]])
async def text_snapshot(session_id: str, db: AsyncSession = Depends(get_db),
                        page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    """Read existing or newly accepted trial messages in their original session."""
    rows, state = await trials.snapshot(db, session_id, page, page_size)
    return success_response(rows, meta=state.model_dump())


@router.post("/{session_id}/turns", operation_id="chat_text_send", response_model=ApiResponse[trials.TextTrialReceipt])
async def text_send(session_id: str, body: TextLabRunRequest,
                    idempotency_key: Annotated[str, Header(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")],
                    db: AsyncSession = Depends(get_db)):
    """Enroll a direct provider call; SSE subscribers do not own its lifetime."""
    return success_response(await trials.send(db, session_id, body, idempotency_key))


@router.get("/{session_id}/events", operation_id="chat_text_events", responses={200: {"content": {"text/event-stream": {}}}})
async def text_events(session_id: str, after: int = Query(0, ge=0), follow: bool = True,
                      last_event_id: Annotated[int, Header(ge=0)] = 0,
                      db: AsyncSession = Depends(get_db, scope="function")):
    """Replay committed text trial events in session cursor order."""
    await trials.require_text(db, session_id)
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)

    async def read_page(cursor):
        async with sessions() as reader:
            return await session_event_page(reader, session_id, cursor)

    return await session_event_stream(read_page, max(after, last_event_id), follow=follow)


router.post("/{session_id}/turns/{task_id}/stop", operation_id="chat_text_stop",
            response_model=ApiResponse[TextLabRunStatus])(cancel_text_lab_stream)
