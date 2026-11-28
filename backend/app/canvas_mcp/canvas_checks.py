"""Expose canvas inspection previews, executions and reports in MCP."""

from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.canvas_mcp.tools import CanvasRef, Identity, canvas_session
from app.schemas.canvas_checks import (
    CanvasCheckPreview, CanvasCheckProduct, CanvasCheckRecheckRequest, CanvasCheckReportRead, CanvasCheckRequest,
    CanvasPostCheckPreview, CanvasPostCheckRequest,
)
from app.services.generation_canvas.generation_inputs import canvas_generation_inputs
from app.services.generation_canvas.runs import canvas_check_runs


def register(server: FastMCP) -> None:
    """Register the canvas check operations."""

    @server.tool()
    async def canvas_check_preview(canvas_ref: CanvasRef, card_id: Identity) -> CanvasCheckPreview:
        """Read the saved check card's generation basis and available pre-generation checks."""
        async with canvas_session() as db:
            return await canvas_generation_inputs(db, canvas_ref.project_id).preview_check(canvas_ref.canvas_id, card_id)

    @server.tool()
    async def canvas_check_run(
        canvas_ref: CanvasRef, card_id: Identity, body: CanvasCheckRequest,
    ) -> CanvasCheckReportRead:
        """Run the selected pre-generation checks for the confirmed basis and return their report."""
        async with canvas_session() as db:
            return await canvas_check_runs(db, canvas_ref.project_id).run_check(canvas_ref.canvas_id, card_id, body)

    @server.tool()
    async def canvas_check_reports(canvas_ref: CanvasRef, card_id: Identity) -> list[CanvasCheckReportRead]:
        """Read retained check reports by their original check card."""
        async with canvas_session() as db:
            return await canvas_check_runs(db, canvas_ref.project_id).reports(canvas_ref.canvas_id, card_id)

    @server.tool()
    async def canvas_check_archived_reports(canvas_ref: CanvasRef) -> list[CanvasCheckReportRead]:
        """Read the retained reports of check cards that were deleted from a canvas."""
        async with canvas_session() as db:
            return await canvas_check_runs(db, canvas_ref.project_id).archived_reports(canvas_ref.canvas_id)

    @server.tool()
    async def canvas_check_cancel(
        canvas_ref: CanvasRef, card_id: Identity, report_id: Identity,
    ) -> CanvasCheckReportRead:
        """Request cancellation of unfinished work for a check report and read its current state."""
        async with canvas_session() as db:
            return await canvas_check_runs(db, canvas_ref.project_id).cancel_check(
                canvas_ref.canvas_id, card_id, report_id,
            )

    @server.tool()
    async def canvas_check_products(canvas_ref: CanvasRef, card_id: Identity) -> list[CanvasCheckProduct]:
        """List retained generation products available to the check card."""
        async with canvas_session() as db:
            return await canvas_generation_inputs(db, canvas_ref.project_id).check_products(canvas_ref.canvas_id, card_id)

    @server.tool()
    async def canvas_post_check_preview(
        canvas_ref: CanvasRef, card_id: Identity, run_id: Identity, node_id: Identity,
        position: Annotated[int, Field(ge=0)],
    ) -> CanvasPostCheckPreview:
        """Preview the original basis and estimated model calls for a selected product."""
        async with canvas_session() as db:
            return await canvas_generation_inputs(db, canvas_ref.project_id).preview_post_check(
                canvas_ref.canvas_id, card_id, run_id, node_id, position,
            )

    @server.tool()
    async def canvas_post_check_run(
        canvas_ref: CanvasRef, card_id: Identity, run_id: Identity, node_id: Identity,
        position: Annotated[int, Field(ge=0)], body: CanvasPostCheckRequest,
    ) -> CanvasCheckReportRead:
        """Run post-generation checks on a selected product with a confirmed basis and call estimate."""
        async with canvas_session() as db:
            return await canvas_check_runs(db, canvas_ref.project_id).run_post_check(
                canvas_ref.canvas_id, card_id, run_id, node_id, position, body,
            )

    @server.tool()
    async def canvas_check_recheck(
        canvas_ref: CanvasRef, card_id: Identity, report_id: Identity, body: CanvasCheckRecheckRequest,
    ) -> CanvasCheckReportRead:
        """Recheck one completed result using an extra lead and the original report's retained evidence."""
        async with canvas_session() as db:
            return await canvas_check_runs(db, canvas_ref.project_id).recheck(
                canvas_ref.canvas_id, card_id, report_id, body,
            )
