"""MCP tools for projections of a canvas layout held by the caller."""

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP

from app.canvas_mcp.tools import CanvasRef, canvas_session
from app.services.generation_canvas.edits import (
    CanvasLayoutPoint,
    CanvasLayoutPreview,
    CanvasLayoutProjection,
    canvas_edits,
)


def register(server: FastMCP) -> None:
    """Expose the shared layout protocol on both canvas types."""

    @server.tool()
    async def canvas_preview_layout(
        canvas_ref: CanvasRef,
        positions: dict[str, CanvasLayoutPoint],
        desired: dict[str, CanvasLayoutPoint],
    ) -> CanvasLayoutPreview:
        """Preview card moves from the host's current positions and requested destinations."""
        async with canvas_session() as db:
            return await canvas_edits(db, canvas_ref.project_id).preview_layout(
                canvas_ref.canvas_id, positions, desired,
            )

    @server.tool()
    async def canvas_project_layout(
        canvas_ref: CanvasRef,
        plan: CanvasLayoutPreview,
        positions: dict[str, CanvasLayoutPoint],
    ) -> CanvasLayoutProjection:
        """Check the preview against the host's latest positions and return positions for the host to apply."""
        async with canvas_session() as db:
            if plan.canvas_id != canvas_ref.canvas_id:
                raise HTTPException(status_code=422, detail='Layout preview belongs to a different canvas')
            return await canvas_edits(db, canvas_ref.project_id).project_layout(plan, positions)
