"""Expose durable canvas generation and published outputs as MCP tools."""
from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.canvas_mcp.tools import CanvasRef, Identity, canvas_session
from app.schemas.generation_canvas import (
    CanvasCardOutputs, CanvasRunAccepted, CanvasRunRead, CanvasRunSubmit, CanvasRuntimeEvent, CanvasSnapshot,
    ImageContentCard, TextContentCard, VideoContentCard,
)
from app.services.generation_canvas.runs import canvas_runs


def register(server: FastMCP) -> None:
    """Register canvas run and output tools for both canvas kinds."""

    @server.tool()
    async def canvas_submit_run(canvas_ref: CanvasRef, command: CanvasRunSubmit) -> CanvasRunAccepted:
        """Submit the prechecked card. Reuse request_id and preview_token to retry the same run."""
        async with canvas_session() as db:
            return await canvas_runs(db, canvas_ref.project_id).submit(canvas_ref.canvas_id, command)

    @server.tool()
    async def canvas_read_run_receipt(canvas_ref: CanvasRef, request_id: Identity) -> CanvasRunAccepted | None:
        """Read the original admission receipt, returning null for an unknown request."""
        async with canvas_session() as db:
            return await canvas_runs(db, canvas_ref.project_id).read_receipt(canvas_ref.canvas_id, request_id)

    @server.tool()
    async def canvas_read_task_run(canvas_ref: CanvasRef, task_id: Identity) -> CanvasRunRead | None:
        """Read the canvas run and its node for a task, returning null for an unknown task."""
        async with canvas_session() as db:
            return await canvas_runs(db, canvas_ref.project_id).read_task_run(canvas_ref.canvas_id, task_id)

    @server.tool()
    async def canvas_runtime_snapshot(canvas_ref: CanvasRef) -> CanvasSnapshot:
        """Read a consistent snapshot of canvas runs, current outputs, and the event cursor."""
        async with canvas_session() as db:
            return await canvas_runs(db, canvas_ref.project_id).snapshot(canvas_ref.canvas_id)

    @server.tool()
    async def canvas_read_run_events(
        canvas_ref: CanvasRef, cursor: Annotated[int, Field(ge=0)] | None = None,
    ) -> list[CanvasRuntimeEvent]:
        """Read events after cursor. An omitted or stale cursor returns a new snapshot event."""
        async with canvas_session() as db:
            return await canvas_runs(db, canvas_ref.project_id).read_events(canvas_ref.canvas_id, cursor)

    @server.tool()
    async def canvas_cancel_run(
        canvas_ref: CanvasRef, run_id: Identity, node_id: Identity | None = None,
    ) -> CanvasRunRead:
        """Explicitly request cancellation of a whole run or just the supplied node."""
        async with canvas_session() as db:
            return await canvas_runs(db, canvas_ref.project_id).cancel(canvas_ref.canvas_id, run_id, node_id)

    @server.tool()
    async def canvas_card_outputs(canvas_ref: CanvasRef, card_id: Identity) -> CanvasCardOutputs:
        """Read published outputs and direct candidates for a card at the saved revision."""
        async with canvas_session() as db:
            return await canvas_runs(db, canvas_ref.project_id).card_outputs(canvas_ref.canvas_id, card_id)

    @server.tool()
    async def canvas_prepare_output_content(
        canvas_ref: CanvasRef, run_id: Identity, node_id: Identity, position: Annotated[int, Field(ge=0)],
    ) -> TextContentCard | ImageContentCard | VideoContentCard:
        """Prepare a content card from a historical output. Save the canvas to add it."""
        async with canvas_session() as db:
            return await canvas_runs(db, canvas_ref.project_id).prepare_output_content(
                canvas_ref.canvas_id, run_id, node_id, position,
            )
