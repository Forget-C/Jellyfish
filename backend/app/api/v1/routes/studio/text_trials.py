"""Direct text trials using the shared conversation transport."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.text_lab import TextLabCancelRequest, TextLabRunStatus
from app.services.generation.runtime.text_chat_streaming import cancel_text_interaction

router = APIRouter()


@router.post('/{session_id}/turns/{task_id}/stop', operation_id='chat_text_stop',
             response_model=ApiResponse[TextLabRunStatus])
async def stop_text_trial(session_id: str, task_id: str, body: TextLabCancelRequest, db: AsyncSession = Depends(get_db)):
    """Cancel a hidden run scoped to its original text trial session."""
    status = await cancel_text_interaction(db, session_id, task_id, body.reason)
    return success_response(TextLabRunStatus(task_id=task_id, status=status))
