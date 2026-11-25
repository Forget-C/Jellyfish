"""Expose the scoped canvas catalog and generation inputs over MCP."""

from typing import Literal

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel

from app.canvas_mcp.tools import CanvasRef, Identity, canvas_session
from app.core.contracts.canvas_catalog import CanvasCatalog
from app.schemas.generation_canvas import (
    CanvasCompiledInput,
    CanvasDocument,
    CanvasModelCapability,
    CanvasPrecheck,
    CanvasPrecheckRequest,
    CanvasResolvedOutput,
    CanvasVideoFrameRequest,
    ImageContentCard,
)
from app.services.generation_canvas.generation_inputs import canvas_generation_inputs
from app.services.generation_canvas.lifecycle import canvas_lifecycle


class CompiledInputWithBasis(CanvasCompiledInput):
    """Distinguish saved inputs from what a caller's own document would generate."""

    basis: Literal['saved', 'provided', 'draft']


class VideoReferenceContext(BaseModel):
    """Available outputs and model capabilities for the caller's visible cards."""

    outputs: dict[str, list[CanvasResolvedOutput]]
    capabilities: dict[str, CanvasModelCapability]


def _check_document_reference(document: CanvasDocument, canvas_ref: CanvasRef) -> None:
    if document.id != canvas_ref.canvas_id or document.project_id != canvas_ref.project_id:
        raise HTTPException(422, 'Document does not match the canvas reference')


def register(server: FastMCP) -> None:
    """Register tools for catalog, model capabilities and generation inputs."""

    @server.tool()
    async def canvas_catalog(canvas_ref: CanvasRef) -> CanvasCatalog:
        """Return the available card types and connection policies for this canvas."""
        async with canvas_session() as db:
            return await canvas_lifecycle(db, canvas_ref.project_id).catalog(canvas_ref.canvas_id)

    @server.tool()
    async def canvas_model_capability(canvas_ref: CanvasRef, model_id: Identity) -> CanvasModelCapability:
        """Return a model's actual input ports and parameter limits in the canvas scope."""
        async with canvas_session() as db:
            return await canvas_lifecycle(db, canvas_ref.project_id).model_capability(canvas_ref.canvas_id, model_id)

    @server.tool()
    async def canvas_compile_input(canvas_ref: CanvasRef, card_id: Identity) -> CompiledInputWithBasis:
        """Compile the current saved card's exact text, media and generation diagnostics."""
        async with canvas_session() as db:
            compiled = await canvas_generation_inputs(db, canvas_ref.project_id).compile_input(
                canvas_ref.canvas_id, card_id,
            )
        return CompiledInputWithBasis(**compiled.model_dump(), basis='saved')

    @server.tool()
    async def canvas_compile_document(
        canvas_ref: CanvasRef,
        document: CanvasDocument,
        card_id: Identity,
        draft: bool = False,
        expected_revision: int | None = None,
    ) -> CompiledInputWithBasis:
        """Compile a caller-provided preview document or an unsaved free draft without saving it."""
        async with canvas_session() as db:
            _check_document_reference(document, canvas_ref)
            compiled = await canvas_generation_inputs(db, canvas_ref.project_id).compile_document(
                document, card_id, draft=draft, expected_revision=expected_revision,
            )
        return CompiledInputWithBasis(**compiled.model_dump(), basis='draft' if draft else 'provided')

    @server.tool()
    async def canvas_video_reference_context(
        canvas_ref: CanvasRef,
        document: CanvasDocument,
        card_ids: set[str],
        expected_revision: int | None,
    ) -> VideoReferenceContext:
        """Resolve outputs and video model ports. Pass null revision for an unsaved free draft."""
        async with canvas_session() as db:
            _check_document_reference(document, canvas_ref)
            outputs, capabilities = await canvas_generation_inputs(db, canvas_ref.project_id).video_reference_context(
                document, card_ids, expected_revision=expected_revision,
            )
        return VideoReferenceContext(outputs=outputs, capabilities=capabilities)

    @server.tool()
    async def canvas_precheck(canvas_ref: CanvasRef, command: CanvasPrecheckRequest) -> CanvasPrecheck:
        """Check the requested run scope and return diagnostics or a token for an eligible run."""
        async with canvas_session() as db:
            return await canvas_generation_inputs(db, canvas_ref.project_id).precheck(canvas_ref.canvas_id, command)

    @server.tool()
    async def canvas_prepare_video_frame(canvas_ref: CanvasRef, command: CanvasVideoFrameRequest) -> ImageContentCard:
        """Prepare a content card containing the selected frame of a saved video or result."""
        async with canvas_session() as db:
            return await canvas_generation_inputs(db, canvas_ref.project_id).prepare_video_frame(
                canvas_ref.canvas_id, command,
            )
