"""Temporary credentials for the single-user app's MCP connection."""
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from hmac import compare_digest
from secrets import token_urlsafe

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.config import settings
from app.schemas.common import ApiResponse, success_response


MCP_PATH = '/mcp'
CONNECTION_LIFETIME = timedelta(hours=8)
router = APIRouter(prefix='/canvas-mcp/connection', tags=['Canvas MCP'])


class CanvasMcpConnectionStatus(BaseModel):
    expires_at: datetime | None


class CanvasMcpConnection(CanvasMcpConnectionStatus):
    path: str = MCP_PATH
    credential: str


@dataclass(frozen=True)
class _ActiveConnection:
    digest: bytes
    expires_at: datetime


_active: _ActiveConnection | None = None


def _active_connection() -> _ActiveConnection | None:
    if _active is not None and _active.expires_at > datetime.now(UTC):
        return _active
    return None


def accepts_credential(authorization: str) -> bool:
    scheme, _, credential = authorization.partition(' ')
    connection = _active_connection()
    return bool(
        connection and scheme.lower() == 'bearer' and credential
        and compare_digest(connection.digest, sha256(credential.encode()).digest())
    )


def allows_origin(origin: str | None) -> bool:
    """Allow only explicit deployment origins for browser requests."""
    return origin is not None and origin != '*' and origin in settings.cors_origins_list


def _browser_request(request: Request, response: Response) -> None:
    if not allows_origin(request.headers.get('origin')):
        raise HTTPException(status_code=403, detail='MCP connection management requires a trusted app origin')
    response.headers['Cache-Control'] = 'no-store'


@router.get('', response_model=ApiResponse[CanvasMcpConnectionStatus], operation_id='canvas_mcp_connection_status')
async def connection_status(response: Response):
    """Report whether a credential is active without returning the credential itself."""
    response.headers['Cache-Control'] = 'no-store'
    connection = _active_connection()
    return success_response(CanvasMcpConnectionStatus(expires_at=connection.expires_at if connection else None))


@router.post('', response_model=ApiResponse[CanvasMcpConnection], operation_id='canvas_mcp_open_connection')
async def open_connection(request: Request, response: Response):
    """Issue a temporary credential. Opening a new connection invalidates the previous one."""
    _browser_request(request, response)
    global _active
    credential = token_urlsafe(32)
    expires_at = datetime.now(UTC) + CONNECTION_LIFETIME
    _active = _ActiveConnection(sha256(credential.encode()).digest(), expires_at)
    return success_response(CanvasMcpConnection(credential=credential, expires_at=expires_at))


@router.delete('', response_model=ApiResponse[CanvasMcpConnectionStatus], operation_id='canvas_mcp_close_connection')
async def close_connection(request: Request, response: Response):
    """Invalidate the active credential without affecting accepted canvas tasks."""
    _browser_request(request, response)
    global _active
    _active = None
    return success_response(CanvasMcpConnectionStatus(expires_at=None))
