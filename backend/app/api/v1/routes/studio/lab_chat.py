"""Unified conversation API for the multimodal laboratory profile."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.lab_chat import ArtifactAnswer, LabChatCommand, LabChatSnapshot, LabModels
from app.services.chat import laboratory
from app.services.chat.stream import session_event_stream

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db, scope='function')]


@router.get('/{session_id}', response_model=ApiResponse[LabChatSnapshot], operation_id='chat_lab_snapshot')
async def lab_snapshot(session_id: str, db: Database):
    return success_response(await laboratory.snapshot(db, session_id))


@router.patch('/{session_id}/models', response_model=ApiResponse[LabModels], operation_id='chat_lab_models')
async def lab_models(session_id: str, body: LabModels, db: Database):
    return success_response(await laboratory.save_models(db, session_id, body))


@router.post('/{session_id}/turns', response_model=ApiResponse[LabChatSnapshot], operation_id='chat_lab_send')
async def lab_send(session_id: str, body: LabChatCommand, db: Database):
    return success_response(await laboratory.send(db, session_id, body))


@router.post('/{session_id}/turns/{turn_id}/answer', response_model=ApiResponse[LabChatSnapshot],
             operation_id='chat_lab_answer')
async def lab_answer(session_id: str, turn_id: str, body: ArtifactAnswer, db: Database):
    """Resume the original turn with the selected archived output."""
    return success_response(await laboratory.answer_turn(db, session_id, turn_id, body))


@router.post('/{session_id}/turns/{turn_id}/stop', response_model=ApiResponse[LabChatSnapshot], operation_id='chat_lab_stop')
async def lab_stop(session_id: str, turn_id: str, db: Database):
    return success_response(await laboratory.stop_turn(db, session_id, turn_id))


@router.get('/{session_id}/events', operation_id='chat_lab_events', responses={200: {'content': {'text/event-stream': {}}}})
async def lab_events(session_id: str, db: Database, after: Annotated[int, Query(ge=0)] = 0,
                     last_event_id: Annotated[int, Header(ge=0)] = 0, follow: bool = True):
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)

    async def read_page(cursor):
        async with sessions() as reader:
            return await laboratory.events(reader, session_id, cursor)

    return await session_event_stream(read_page, max(after, last_event_id), follow=follow)
