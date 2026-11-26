"""Direct text trials using the shared conversation transport."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.experiment_sessions import ExperimentMessageRead
from app.schemas.studio.text_lab import TextLabCancelRequest, TextLabRunStatus
from app.services.generation.runtime.text_chat_streaming import cancel_text_interaction
from app.services.studio import text_trials as trials

router = APIRouter()


@router.get("/{session_id}", operation_id="chat_text_snapshot", response_model=ApiResponse[list[ExperimentMessageRead]])
async def text_snapshot(session_id: str, db: AsyncSession = Depends(get_db),
                        page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    """Read existing or newly accepted trial messages in their original session."""
    rows, state = await trials.snapshot(db, session_id, page, page_size)
    return success_response(rows, meta=state.model_dump())


@router.post('/{session_id}/turns/{task_id}/stop', operation_id='chat_text_stop',
             response_model=ApiResponse[TextLabRunStatus])
async def stop_text_trial(session_id: str, task_id: str, body: TextLabCancelRequest, db: AsyncSession = Depends(get_db)):
    """Cancel a hidden run scoped to its original text trial session."""
    status = await cancel_text_interaction(db, session_id, task_id, body.reason)
    return success_response(TextLabRunStatus(task_id=task_id, status=status))
