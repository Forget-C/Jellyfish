"""Manage the MCP connection from Jellyfish settings."""
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.canvas_mcp.connection import MCP_PATH, allows_origin, connection_state
from app.schemas.common import ApiResponse, success_response


router = APIRouter(prefix='/canvas-mcp/connection', tags=['Canvas MCP'])


class CanvasMcpConnectionStatus(BaseModel):
    expires_at: datetime | None


class CanvasMcpConnection(CanvasMcpConnectionStatus):
    path: str = MCP_PATH
    credential: str


def _browser_request(request: Request, response: Response) -> None:
    if not allows_origin(request.headers.get('origin')):
        raise HTTPException(status_code=403, detail='MCP connection management requires a trusted app origin')
    response.headers['Cache-Control'] = 'no-store'


@router.get('', response_model=ApiResponse[CanvasMcpConnectionStatus], operation_id='canvas_mcp_connection_status')
async def connection_status(response: Response):
    """Report whether a credential is active without returning the credential itself."""
    response.headers['Cache-Control'] = 'no-store'
    return success_response(CanvasMcpConnectionStatus(expires_at=connection_state.expires_at()))


@router.post('', response_model=ApiResponse[CanvasMcpConnection], operation_id='canvas_mcp_open_connection')
async def open_connection(request: Request, response: Response):
    """Issue a temporary credential. Opening a new connection invalidates the previous one."""
    _browser_request(request, response)
    issued = connection_state.issue()
    return success_response(CanvasMcpConnection(credential=issued.credential, expires_at=issued.expires_at))


@router.delete('', response_model=ApiResponse[CanvasMcpConnectionStatus], operation_id='canvas_mcp_close_connection')
async def close_connection(request: Request, response: Response):
    """Invalidate the active credential without affecting accepted canvas tasks."""
    _browser_request(request, response)
    connection_state.close()
    return success_response(CanvasMcpConnectionStatus(expires_at=None))
