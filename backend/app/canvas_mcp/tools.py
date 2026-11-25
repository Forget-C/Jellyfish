"""Shared MCP tool input and transaction handling."""
import json
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import BaseModel, ConfigDict, Field

from app.dependencies import get_db
from app.schemas.common import PaginatedData, paginated_response
from app.schemas.generation_canvas import CanvasRead, CanvasSummary
from app.core.contracts.directing.scene_canvas import SceneCanvasesRead, SceneCanvasSummary
from app.services.generation_canvas.lifecycle import (
    canvas_lifecycle,
    free_canvas_lifecycle,
    scene_canvas_lifecycle,
)


Identity = Annotated[str, Field(min_length=1)]


class CanvasRef(BaseModel):
    """Use project_id for a scene canvas, and omit it for a free canvas."""

    model_config = ConfigDict(extra='forbid')
    canvas_id: Identity
    project_id: Identity | None = None


class CanvasReadWithRef(CanvasRead):
    canvas_ref: CanvasRef


class FreeCanvasSummaryWithRef(CanvasSummary):
    canvas_ref: CanvasRef


class SceneCanvasSummaryWithRef(SceneCanvasSummary):
    canvas_ref: CanvasRef


class SceneCanvasesWithRef(SceneCanvasesRead):
    canvases: list[SceneCanvasSummaryWithRef]


def canvas_read_result(canvas: CanvasRead) -> CanvasReadWithRef:
    """Attach a reference that the caller can pass back to any shared canvas tool."""
    return CanvasReadWithRef(
        **canvas.model_dump(), canvas_ref=CanvasRef(canvas_id=canvas.id, project_id=canvas.project_id),
    )


@asynccontextmanager
async def canvas_session():
    """Use the existing request transaction and return expected domain failures as tool errors."""
    try:
        async with asynccontextmanager(get_db)() as db:
            yield db
    except HTTPException as error:
        detail = json.dumps({'status': error.status_code, 'detail': error.detail}, ensure_ascii=False)
        raise ToolError(detail) from error


def register(server: FastMCP) -> None:
    """Register the discovery and read tools for both canvas kinds."""

    @server.tool()
    async def canvas_list_free(
        q: str = '',
        page: Annotated[int, Field(ge=1)] = 1,
        page_size: Annotated[int, Field(ge=1, le=100)] = 24,
    ) -> PaginatedData[FreeCanvasSummaryWithRef]:
        """Search and page through free canvases. Pass canvas_ref to read or modify a result."""
        async with canvas_session() as db:
            summaries, total = await free_canvas_lifecycle(db).summaries(q=q, page=page, page_size=page_size)
        items = [
            FreeCanvasSummaryWithRef(**item.model_dump(), canvas_ref=CanvasRef(canvas_id=item.id))
            for item in summaries
        ]
        return paginated_response(items, page=page, page_size=page_size, total=total).data

    @server.tool()
    async def canvas_list_scene(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity,
    ) -> SceneCanvasesWithRef:
        """List storyboard canvases for a scene. Pass canvas_ref to read or modify a result."""
        async with canvas_session() as db:
            result = await scene_canvas_lifecycle(db, project_id).read_canvases(chapter_id, sequence_id)
        return SceneCanvasesWithRef(
            sequence=result.sequence,
            canvases=[
                SceneCanvasSummaryWithRef(
                    **item.model_dump(), canvas_ref=CanvasRef(canvas_id=item.id, project_id=project_id),
                )
                for item in result.canvases
            ],
        )

    @server.tool()
    async def canvas_read(canvas_ref: CanvasRef) -> CanvasReadWithRef:
        """Read a canvas document and its current saved revision using its reference."""
        async with canvas_session() as db:
            canvas = await canvas_lifecycle(db, canvas_ref.project_id).read(canvas_ref.canvas_id)
        return canvas_read_result(canvas)
