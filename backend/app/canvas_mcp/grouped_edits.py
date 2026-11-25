"""Preview and apply grouped edits through the shared canvas protocol."""

from base64 import urlsafe_b64decode, urlsafe_b64encode
from hmac import compare_digest, digest
from secrets import token_bytes
from typing import Annotated

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import BaseModel, Field

from app.canvas_mcp.tools import CanvasRef, Identity, canvas_session
from app.schemas.canvas_edit_intents import CanvasEditIntent
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.edits import (
    CanvasEditGroup, CanvasEditGroupPreview, CanvasEditPreview, CanvasEditReceipt, canvas_edits,
)


# The API process issues and verifies references across independent MCP requests.
_PREVIEW_KEY = token_bytes(32)


class CanvasEditPreviewWithRef(CanvasEditPreview):
    """The canonical differences and a reference to that exact plan."""

    preview_ref: str


class CanvasEditReceiptLookup(BaseModel):
    """A persisted edit receipt, if the request was previously submitted."""

    result: CanvasEditReceipt | None


def _signature(canvas_ref: CanvasRef, payload: str) -> bytes:
    message = f'{canvas_ref.model_dump_json()}.{payload}'.encode()
    return digest(_PREVIEW_KEY, message, 'sha256').hex().encode()


def _preview_ref(canvas_ref: CanvasRef, plan: CanvasEditPreview) -> str:
    payload = urlsafe_b64encode(plan.model_dump_json().encode()).decode()
    return f'{_signature(canvas_ref, payload).decode()}.{payload}'


def _resolve_preview(canvas_ref: CanvasRef, preview_ref: str) -> CanvasEditPreview:
    signature, _, payload = preview_ref.partition('.')
    if not compare_digest(signature.encode(), _signature(canvas_ref, payload)):
        raise ToolError('Invalid preview_ref for this canvas. Run canvas_preview_edits again.')
    return CanvasEditPreview.model_validate_json(urlsafe_b64decode(payload))


def register(server: FastMCP) -> None:
    """Register preview, grouped commit, and receipt lookup."""

    @server.tool()
    async def canvas_preview_edits(
        canvas_ref: CanvasRef,
        groups: list[CanvasEditGroup],
        expected_revision: Annotated[int, Field(ge=0)] | None = None,
    ) -> CanvasEditPreviewWithRef:
        """Preview the actual differences of ordered edit groups on a saved canvas."""
        async with canvas_session() as db:
            plan = await canvas_edits(db, canvas_ref.project_id).preview(
                canvas_ref.canvas_id, groups, expected_revision=expected_revision,
            )
        return CanvasEditPreviewWithRef(**plan.model_dump(), preview_ref=_preview_ref(canvas_ref, plan))

    @server.tool()
    async def canvas_preview_visible_group(
        canvas_ref: CanvasRef,
        visible: CanvasDocument,
        group_id: Identity,
        intents: list[CanvasEditIntent],
        expected_revision: Annotated[int, Field(ge=0)] | None = None,
    ) -> CanvasEditGroupPreview:
        """Preview one edit group against the visible document. Omit revision for a free draft."""
        if visible.id != canvas_ref.canvas_id or visible.project_id != canvas_ref.project_id:
            raise ToolError('The visible document must match canvas_ref.')
        async with canvas_session() as db:
            return await canvas_edits(db, canvas_ref.project_id).preview_visible_group(
                visible, group_id, intents, expected_revision=expected_revision,
            )

    @server.tool()
    async def canvas_submit_edits(
        canvas_ref: CanvasRef, preview_ref: Identity, request_id: Identity, group_ids: tuple[Identity, ...] | None = None,
    ) -> CanvasEditReceipt:
        """Apply chosen groups from a preview. Reuse request_id to retry the same submission."""
        plan = _resolve_preview(canvas_ref, preview_ref)
        async with canvas_session() as db:
            return await canvas_edits(db, canvas_ref.project_id).submit(plan, request_id=request_id, group_ids=group_ids)

    @server.tool()
    async def canvas_read_edit_receipt(canvas_ref: CanvasRef, request_id: Identity) -> CanvasEditReceiptLookup:
        """Read the original grouped-edit receipt, returning a null result for an unknown request."""
        async with canvas_session() as db:
            receipt = await canvas_edits(db, canvas_ref.project_id).read_receipt(canvas_ref.canvas_id, request_id)
        return CanvasEditReceiptLookup(result=receipt)
