"""Public session operations for the canvas chat profile."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes.studio import generation_canvases as canvas_routes
from app.dependencies import get_db
from app.schemas.canvas_assistant import CanvasAssistantExchange, CanvasAssistantHistory
from app.schemas.common import ApiResponse, success_response
from app.services.chat.snapshots import canvas_snapshot as read_canvas_snapshot, stop_canvas_snapshot

router = APIRouter()


@router.get('/canvas/{canvas_id}', response_model=ApiResponse[CanvasAssistantHistory], operation_id='chat_canvas_snapshot')
async def canvas_snapshot(canvas_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """Open the canvas conversation at its latest committed cursor."""
    return success_response(await read_canvas_snapshot(db, canvas_id, project_id))


@router.post('/canvas/{canvas_id}/turns/{source_id}/stop/snapshot',
             response_model=ApiResponse[CanvasAssistantHistory], operation_id='chat_canvas_stop_snapshot')
async def canvas_stop_snapshot(canvas_id: str, source_id: str, project_id: str = '',
                               db: AsyncSession = Depends(get_db, scope='function')):
    """Confirm the stop together with the new cursor and current assistant state."""
    return success_response(await stop_canvas_snapshot(db, canvas_id, project_id, source_id))


# Share the existing canvas authorization, approval and execution receipts.
router.add_api_route('/canvas/{canvas_id}/turns/{source_id}/stop', canvas_routes.stop_assistant_turn,
                     methods=['POST'], response_model=ApiResponse[CanvasAssistantExchange], operation_id='chat_canvas_stop')
router.add_api_route('/canvas/{canvas_id}/proposals/{source_id}', canvas_routes.decide_assistant_proposal,
                     methods=['POST'], response_model=ApiResponse[canvas_routes.CanvasAssistantProposalResult], operation_id='chat_canvas_decide')
router.add_api_route('/canvas/{canvas_id}/layout/{source_id}', canvas_routes.decide_layout,
                     methods=['POST'], response_model=ApiResponse[canvas_routes.CanvasAssistantLayout], operation_id='chat_canvas_layout')
router.add_api_route('/canvas/{canvas_id}/generations/{source_id}/approval', canvas_routes.reapprove_canvas_generation,
                     methods=['POST'], response_model=ApiResponse[canvas_routes.CanvasAssistantGenerationRead], operation_id='chat_canvas_generation')
