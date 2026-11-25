"""Serve the shared canvas tools over MCP Streamable HTTP."""
import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.canvas_mcp import (
    canvas_checks, generation_inputs, generation_runs, grouped_edits, layout, lifecycle, storyboards, tools,
)
from app.canvas_mcp.connection import MCP_PATH, allows_origin, connection_state


def create_server() -> FastMCP:
    """A fresh SDK server is needed on each application startup."""
    server = FastMCP(
        'Jellyfish Canvas',
        stateless_http=True,
        json_response=True,
        streamable_http_path=MCP_PATH,
        # The outer endpoint validates Origins against Jellyfish deployment settings.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    tools.register(server)
    lifecycle.register(server)
    layout.register(server)
    grouped_edits.register(server)
    canvas_checks.register(server)
    generation_inputs.register(server)
    generation_runs.register(server)
    storyboards.register(server)
    return server


@asynccontextmanager
async def run_transport() -> AsyncIterator[ASGIApp]:
    """The task that enters the SDK's cancel scope must also exit it."""
    server = create_server()
    transport = server.streamable_http_app()
    started = asyncio.Event()
    stop = asyncio.Event()

    async def run():
        async with server.session_manager.run():
            started.set()
            await stop.wait()

    manager = asyncio.create_task(run())
    ready = asyncio.create_task(started.wait())
    try:
        await asyncio.wait((manager, ready), return_when=asyncio.FIRST_COMPLETED)
        if manager.done():
            await manager
        yield transport
    finally:
        ready.cancel()
        stop.set()
        await asyncio.gather(ready, return_exceptions=True)
        await manager


class CanvasMcpEndpoint:
    """Validate the browser origin and bearer credential for every MCP HTTP request."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        headers = Headers(scope=scope)
        origin = headers.get('origin')
        if origin is not None and not allows_origin(origin):
            await JSONResponse({'error': 'Invalid Origin'}, status_code=403)(scope, receive, send)
            return
        scheme, _, credential = headers.get('authorization', '').partition(' ')
        if scheme.lower() != 'bearer' or not credential or not connection_state.accepts(credential):
            await JSONResponse(
                {'error': 'A valid canvas MCP credential is required'},
                status_code=401,
                headers={'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store'},
            )(scope, receive, send)
            return
        await scope['app'].state.canvas_mcp_transport(scope, receive, send)
