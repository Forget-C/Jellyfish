"""Create and manage free and scene canvas documents through MCP."""
from typing import Annotated
from uuid import UUID

from mcp.server.fastmcp import FastMCP
from pydantic import ConfigDict, Field

from app.canvas_mcp.tools import CanvasReadWithRef, CanvasRef, Identity, canvas_read_result, canvas_session
from app.core.contracts.directing.scene_canvas import SceneCanvasCreate
from app.schemas.canvas_assistant_draft import CanvasDraftSave
from app.schemas.generation_canvas import CanvasCreate, CanvasDocument, CanvasRename, CanvasSave, CanvasSaved
from app.services.generation_canvas.edits import CanvasEditGroup, CanvasEditPreview, canvas_edits, free_canvas_edits
from app.services.generation_canvas.lifecycle import canvas_lifecycle, free_canvas_lifecycle, scene_canvas_lifecycle


class FreeCanvasRef(CanvasRef):
    """Accept only references to the independent canvas workspace."""

    project_id: None = None


class CanvasDraftDocumentSave(CanvasSave):
    """The first-save command for a draft document."""

    model_config = ConfigDict(extra='forbid')


def register(server: FastMCP) -> None:
    """Register canvas lifecycle and document save tools."""

    @server.tool()
    async def canvas_create_free(command: CanvasCreate) -> CanvasReadWithRef:
        """Create an empty free canvas and return its document and reference."""
        async with canvas_session() as db:
            canvas = await free_canvas_lifecycle(db).create_free(command)
        return canvas_read_result(canvas)

    @server.tool()
    async def canvas_create_scene(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity, command: SceneCanvasCreate,
    ) -> CanvasReadWithRef:
        """Create a storyboard canvas for a scene with confirmed source text."""
        async with canvas_session() as db:
            canvas = await scene_canvas_lifecycle(db, project_id).create_canvas(chapter_id, sequence_id, command)
        return canvas_read_result(canvas)

    @server.tool()
    async def canvas_rename_free(canvas_ref: FreeCanvasRef, command: CanvasRename) -> CanvasReadWithRef:
        """Rename a free canvas at the expected saved revision."""
        async with canvas_session() as db:
            canvas = await free_canvas_lifecycle(db).rename(canvas_ref.canvas_id, command.name, command.expected_revision)
        return canvas_read_result(canvas)

    @server.tool()
    async def canvas_save(canvas_ref: CanvasRef, command: CanvasSave) -> CanvasSaved:
        """Save a complete canvas document at the expected revision and return its idempotent receipt."""
        async with canvas_session() as db:
            receipt = await canvas_edits(db, canvas_ref.project_id).save(canvas_ref.canvas_id, command)
        return CanvasSaved.model_validate(receipt)

    @server.tool()
    async def canvas_delete(
        canvas_ref: CanvasRef, expected_revision: Annotated[int, Field(ge=0)],
    ) -> CanvasRef:
        """Delete an idle canvas at the expected revision and return its reference."""
        async with canvas_session() as db:
            await canvas_lifecycle(db, canvas_ref.project_id).delete(
                canvas_ref.canvas_id, expected_revision=expected_revision,
            )
        return canvas_ref

    @server.tool()
    async def canvas_draft_read(canvas_id: UUID) -> CanvasReadWithRef:
        """Read a free draft by its client-generated UUID. Revision -1 means it is unsaved."""
        async with canvas_session() as db:
            canvas = await free_canvas_lifecycle(db).read_free_draft(str(canvas_id))
        return canvas_read_result(canvas)

    @server.tool()
    async def canvas_draft_preview(document: CanvasDocument, groups: list[CanvasEditGroup]) -> CanvasEditPreview:
        """Preview grouped changes to an unsaved free draft document without creating a canvas."""
        async with canvas_session() as db:
            return await free_canvas_edits(db).preview_draft(document, groups)

    @server.tool()
    async def canvas_draft_save(canvas_id: UUID, command: CanvasDraftDocumentSave) -> CanvasSaved:
        """Save the first free canvas document at expected revision 0. Retry with the same request ID."""
        async with canvas_session() as db:
            receipt = await free_canvas_edits(db).save_free_draft(
                str(canvas_id), CanvasDraftSave.model_validate(command.model_dump()),
            )
        return CanvasSaved.model_validate(receipt)
