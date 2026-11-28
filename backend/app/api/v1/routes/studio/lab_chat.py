"""Unified conversation API for the multimodal laboratory profile."""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.lab_chat import LabChatSnapshot, LabModels
from app.services.chat import laboratory

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db, scope='function')]


@router.patch('/{session_id}/models', response_model=ApiResponse[LabModels], operation_id='chat_lab_models')
async def lab_models(session_id: str, body: LabModels, db: Database):
    return success_response(await laboratory.save_models(db, session_id, body))


@router.post('/{session_id}/turns/{turn_id}/stop', response_model=ApiResponse[LabChatSnapshot], operation_id='chat_lab_stop')
async def lab_stop(session_id: str, turn_id: str, db: Database):
    return success_response(await laboratory.stop_turn(db, session_id, turn_id))
