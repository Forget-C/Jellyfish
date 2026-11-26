"""Media trial history exposed alongside the unified chat transport."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.experiment_sessions import ExperimentMessageRead
from app.services.studio.media_trials import media_snapshot as read_media_snapshot

chat_router = APIRouter()


@chat_router.get('/media/{session_id}', response_model=ApiResponse[list[ExperimentMessageRead]], operation_id='chat_media_snapshot')
async def media_snapshot(session_id: str, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100),
                         db: AsyncSession = Depends(get_db)):
    """Restore submitted parameters, references and current task receipts."""
    rows, state = await read_media_snapshot(db, session_id, page, page_size)
    return success_response(rows, meta=state.model_dump())
