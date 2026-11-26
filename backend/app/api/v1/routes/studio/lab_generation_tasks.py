"""Media trial history exposed alongside the unified chat transport."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.experiment_sessions import ExperimentSession, ExperimentSessionEvent
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.experiment_sessions import ExperimentMessageRead
from app.services.studio.experiment_messages import read_experiment_page

chat_router = APIRouter()


async def _media_session(db, session_id):
    session = await db.get(ExperimentSession, session_id)
    if session is None or session.lab_type not in ('image', 'video'):
        raise HTTPException(404, 'Media trial session not found')
    return session


@chat_router.get('/media/{session_id}', response_model=ApiResponse[list[ExperimentMessageRead]], operation_id='chat_media_snapshot')
async def media_snapshot(session_id: str, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100),
                         db: AsyncSession = Depends(get_db)):
    """Restore submitted parameters, references and current task receipts."""
    await _media_session(db, session_id)
    cursor = await db.scalar(select(func.max(ExperimentSessionEvent.cursor))
                             .where(ExperimentSessionEvent.session_id == session_id))
    return success_response(await read_experiment_page(db, session_id, page, page_size, include_media_receipts=True), meta={
        'session_id': session_id, 'cursor': cursor or 0, 'capabilities': ('snapshot', 'send', 'events', 'task_receipt'),
    })
