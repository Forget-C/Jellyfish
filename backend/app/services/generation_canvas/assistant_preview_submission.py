"""Make validated read-only previews available for exact user-initiated approval submission."""

from fastapi import HTTPException
from sqlalchemy import update

from app.models.canvas_assistant import CanvasAssistantPreview
from app.schemas.canvas_assistant import CanvasAssistantReadOnlyPreview
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.planning_tools import CanvasPlanningPreview
from app.services.generation_canvas.store import CanvasStore


def _basis(document: CanvasDocument) -> str:
    return CanvasStore.command_digest(document.model_dump(mode='json'))


def retain_preview(db, preview: CanvasPlanningPreview, document: CanvasDocument, *,
                   source_id: str, model_id: str, draft: bool) -> CanvasAssistantReadOnlyPreview:
    """Store the canonical plan and expose a reviewable summary, with no approval request."""
    db.add(CanvasAssistantPreview(
        id=preview.preview_id, canvas_id=document.id, project_id=document.project_id, source_id=source_id,
        model_id=model_id, draft=draft, basis=_basis(document), snapshot=preview.model_dump(mode='json'),
    ))
    return CanvasAssistantReadOnlyPreview(id=preview.preview_id, revision=preview.plan.revision, proposal=preview.proposal)


async def claim_preview(db, preview_id: str, canvas_id: str, project_id: str | None, document: CanvasDocument,
                        *, revision: int, source_id: str, draft: bool) -> tuple[CanvasAssistantPreview, CanvasPlanningPreview]:
    """Lock one exact candidate and allow replay only with the original submission identity."""
    if db.get_bind().dialect.name == 'sqlite':
        await db.execute(update(CanvasAssistantPreview).where(CanvasAssistantPreview.id == preview_id)
                         .values(submitted_source=CanvasAssistantPreview.submitted_source))
    row = await db.get(CanvasAssistantPreview, preview_id, with_for_update=True, populate_existing=True)
    if (not row or row.canvas_id != canvas_id or row.project_id != project_id or row.draft != draft
            or row.basis != _basis(document) or (row.submitted_source and row.submitted_source != source_id)):
        raise HTTPException(409, '此预演已变化或已送审，请重新预演或查看原审批卡。')
    preview = CanvasPlanningPreview.model_validate(row.snapshot)
    if row.submitted_source is None and preview.plan.revision != revision:
        raise HTTPException(409, '画布已变化，请重新预演后送审。')
    row.submitted_source = source_id
    return row, preview
