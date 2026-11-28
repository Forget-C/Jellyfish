"""Promote historical browser-owned canvas conversations during the first save."""
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.canvas_assistant import CanvasAssistantSession, CanvasAssistantTurn
from app.schemas.canvas_assistant import CanvasAssistantExchange
from app.schemas.canvas_assistant_draft import CanvasDraftSave
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.approval_upgrade import expired_approval
from app.services.generation_canvas.assistant_edit_projection import publish_assistant_edit_execution
from app.services.generation_canvas.assistant_events import publish_events
from app.services.generation_canvas.assistant_media import resolve_assistant_media, retain_assistant_media
from app.services.generation_canvas.draft_canvas_approvals import (
    confirm_draft_approval, draft_approval_is_active, draft_approval_origin, find_draft_approval, promote_draft_approval,
)


def _first_save_document(command: CanvasDraftSave) -> CanvasDocument:
    try:
        return CanvasDocument.model_validate(command.document)
    except ValidationError as error:
        raise HTTPException(422, 'Invalid draft canvas document') from error


async def prepare_draft_approval(store, canvas, command: CanvasDraftSave):
    """Verify the original server version and project selected groups before the first write."""
    approval = command.assistant_approval
    if approval is None:
        return None
    turns = command.assistant.validated_turns() if command.assistant else ()
    selected = next((turn for turn in turns if turn.request_id == approval.source_id), None)
    document = _first_save_document(command)
    if selected is None or document.id != canvas.id or document.project_id is not None:
        raise expired_approval()
    request = await find_draft_approval(store.db, document, selected.request_id, selected.proposal,
                                        origin_id=draft_approval_origin(turns, selected.request_id))
    if request is None:
        raise expired_approval()
    projected = await confirm_draft_approval(
        store.db, document, request, tuple(approval.group_ids), request_id=command.request_id,
    )
    return projected.model_dump(mode='json')


async def attach_draft_conversation(store, command: CanvasDraftSave, receipt: dict):
    """Publish browser-owned prose and verified approval/project receipts with the saved draft."""
    conversation = command.assistant
    if not conversation or not conversation.turns:
        return
    canvas_id = receipt['canvas_id']
    session = CanvasAssistantSession(canvas_id=canvas_id, sequence=len(conversation.turns), model_id=conversation.model_id)
    store.db.add(session)
    await store.db.flush()
    turns = conversation.validated_turns()
    document = _first_save_document(command)
    files = {item.file_id for turn in turns for item in (turn.attachments or [])}
    sources = await resolve_assistant_media(store.db, None, sorted(files))
    await retain_assistant_media(store.db, None, canvas_id, sources)
    approval = command.assistant_approval
    for turn in turns:
        request = None
        if turn.proposal is not None:
            try:
                origin = draft_approval_origin(turns, turn.request_id)
            except HTTPException:
                # Old browser dialogue may refer to a proposal the current service never issued.
                origin = None
            if origin is not None:
                request = await find_draft_approval(store.db, document, turn.request_id, turn.proposal,
                                                    origin_id=origin)
        proposal = turn.proposal if request else None
        active = bool(request and await draft_approval_is_active(store.db, request))
        if proposal and not active:
            proposal.state = 'superseded'
            for group in proposal.groups:
                if group.state == 'pending':
                    group.state = 'superseded'
        selected = tuple(approval.group_ids) if approval and turn.request_id == approval.source_id else ()
        attachments = [item.model_dump(mode='json') for item in (turn.attachments or []) if item.file_id in sources]
        store.db.add(CanvasAssistantTurn(canvas_id=canvas_id, request_id=turn.request_id, sequence=turn.sequence,
            model_id=turn.model_id, text=turn.text, reply=turn.reply, revises=turn.revises, repairs=turn.repairs,
            context=turn.context.model_dump(mode='json') if turn.context else None,
            skills=[skill.model_dump(mode='json') for skill in (turn.skills or [])],
            canvas_references=[item.model_dump(mode='json') for item in turn.canvas_references] if turn.canvas_references else None,
            attachments=attachments, proposal=proposal.model_dump(mode='json') if proposal else None,
            approval_requests={'edit': request.id} if request else None,
            proposal_issues=[issue.model_dump(mode='json') for issue in (turn.proposal_issues or [])] or None))
        exchange = CanvasAssistantExchange.model_validate({
            **turn.model_dump(mode='json', exclude={'preview', 'submitted_preview_id'}),
            'proposal': proposal, 'approval_audit': None, 'attachments': attachments,
        })
        publish_events(store.db, session, exchange, 'turn.completed')
        if active:
            decision, group_receipts = await promote_draft_approval(
                store.db, request, canvas_revision=receipt['revision'], approved_group_ids=selected,
            )
            for item in group_receipts:
                await publish_assistant_edit_execution(store.db, None, canvas_id, decision, item)
    await store.db.flush()
