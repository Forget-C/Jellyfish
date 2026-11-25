"""Serve the shared canvas tools over MCP Streamable HTTP."""
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import Receive, Scope, Send

from app.canvas_mcp import generation_inputs, grouped_edits, layout, lifecycle, tools
from app.canvas_mcp.connection import MCP_PATH, accepts_credential, allows_origin


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
    generation_inputs.register(server)
    return server


class CanvasMcpEndpoint:
    """Validate the browser origin and bearer credential for every MCP HTTP request."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        headers = Headers(scope=scope)
        origin = headers.get('origin')
        if origin is not None and not allows_origin(origin):
            await JSONResponse({'error': 'Invalid Origin'}, status_code=403)(scope, receive, send)
            return
        if not accepts_credential(headers.get('authorization', '')):
            await JSONResponse(
                {'error': 'A valid canvas MCP credential is required'},
                status_code=401,
                headers={'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store'},
            )(scope, receive, send)
            return
        await scope['app'].state.canvas_mcp_transport(scope, receive, send)
