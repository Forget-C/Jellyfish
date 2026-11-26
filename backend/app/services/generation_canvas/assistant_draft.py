"""Keep unsaved free canvas conversations in the browser until first save."""


from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.canvas_assistant import CanvasAssistantSession, CanvasAssistantTurn
from app.models.generation_canvas import GenerationCanvas
from app.schemas.canvas_assistant import CanvasAssistantExchange
from app.schemas.canvas_assistant_draft import CanvasDraftSave, DraftAssistantMessage
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.assistant import CanvasAssistant, MODEL_FAILURE_REPLIES, prepare_proposal_repair
from app.services.generation_canvas.assistant_context import resolve_assistant_context, resolve_external_canvas_cards
from app.services.generation_canvas.assistant_edits import CanvasAssistantEditDraft
from app.services.generation_canvas.assistant_edit_projection import publish_assistant_edit_execution
from app.services.generation_canvas.assistant_events import publish_events
from app.services.generation_canvas.assistant_media import (
    describe_assistant_media, resolve_assistant_media, retain_assistant_media,
)
from app.services.generation_canvas.assistant_structure import structural_preview_tool
from app.services.generation_canvas.approval_upgrade import expired_approval
from app.services.generation_canvas.draft_canvas_approvals import (
    confirm_draft_approval, draft_approval_is_active, draft_approval_origin, find_draft_approval,
    promote_draft_approval, stage_draft_approval,
)
from app.services.generation_canvas.assistant_preview_submission import claim_preview, retain_preview
from app.services.generation_canvas.model_adapter import CanvasModelAdapter
from app.services.generation_canvas.planning_tools import CanvasPlanningTools


class DraftCanvasAssistant(CanvasAssistant):
    """Use the same model and tools for a browser-owned transcript."""

    async def reply_to_draft(self, canvas_id: str, command: DraftAssistantMessage) -> CanvasAssistantExchange:
        """Read the browser snapshot, without creating a canvas or session."""
        if await self.db.get(GenerationCanvas, canvas_id) is not None:
            raise HTTPException(409, 'The draft has already been saved')
        turns = command.validated_turns()
        if len(turns) == 100 or any(turn.request_id == command.request_id for turn in turns):
            raise HTTPException(422, 'The draft assistant transcript is full or contains this request')
        if command.submit_preview_id:
            return await self._submit_draft_preview(canvas_id, command, len(turns) + 1)
        context, edit_draft, adapter = None, None, None
        if command.context:
            canvas = GenerationCanvas(id=canvas_id, kind='free', revision=0)
            context = resolve_assistant_context(canvas, command.context, command.text)
            visible = CanvasDocument.model_validate(command.context.draft)
            edit_draft = CanvasAssistantEditDraft(context, visible)
            edit_draft.user_request = command.text
            sessions = async_sessionmaker(bind=self.db.bind, expire_on_commit=False)
            adapter = CanvasModelAdapter(CanvasPlanningTools(sessions, None, canvas_id, context, edit_draft, draft=True))
        model, provider, capability = await self._resolve_model(command.model_id)
        client = await self._model_client(model, provider, capability, stream_reply=command.stream_reply)
        model_id = model.id
        sources = await resolve_assistant_media(self.db, None, command.attachment_file_ids)
        structure = structural_preview_tool(edit_draft, 'free', sources) if edit_draft else None
        await self.db.rollback()
        messages = []
        for turn in turns:
            messages.extend([HumanMessage(content=turn.text), AIMessage(content=turn.reply)])
        referenced = await resolve_external_canvas_cards(self.store, canvas_id, command.canvas_references)
        text = (command.text + '\n\n以下是其他画布的只读参考，不得修改来源卡片。\n' + referenced
                if referenced else command.text)
        if command.repairs:
            source = next((turn for turn in turns if turn.request_id == command.repairs), None)
            if not source or not source.proposal_issues or not edit_draft or command.revises:
                raise HTTPException(422, "Choose a failed proposal on this canvas to repair")
            text += prepare_proposal_repair(edit_draft, source)
        content, attachments = await describe_assistant_media(
            text, command.attachment_file_ids, sources, capability=capability,
        )
        messages.append(HumanMessage(content=content))
        async def complete(on_reply=None, on_phase=None, partial_reply=lambda: ''):
            try:
                reply, skills, observed = await self._reply(
                    client, messages, context, edit_draft, supports_tools=capability.tool_results, model_adapter=adapter,
                    structure_tool=structure,
                    max_input_tokens=capability.max_input_tokens, on_reply=on_reply, on_phase=on_phase,
                )
            except HTTPException as error:
                if not isinstance(error.detail, str) or error.detail not in MODEL_FAILURE_REPLIES:
                    raise
                reply = '\n\n'.join(filter(None, [partial_reply(), MODEL_FAILURE_REPLIES[error.detail]]))
                skills, observed = [], None
            if context is not None:
                context.observed_card_ids = observed
            proposal = preview = None
            if adapter and adapter.latest_preview.plan:
                from app.services.generation_canvas.assistant_versioned_approval import can_submit_canvas_edit
                if can_submit_canvas_edit(command.text):
                    staged = adapter.planning.get_preview(adapter.latest_preview.preview_id)
                    if staged and staged.proposal:
                        origin = (draft_approval_origin(turns, command.revises)
                                  if command.revises else command.request_id)
                        async with adapter.planning.sessions.begin() as db:
                            await stage_draft_approval(db, edit_draft.visible_document, command.request_id,
                                                       staged.proposal, staged.plan, origin_id=origin,
                                                       revises=command.revises)
                        proposal = staged.proposal
                else:
                    async with adapter.planning.sessions.begin() as db:
                        preview = retain_preview(db, adapter.latest_preview, edit_draft.visible_document,
                                                 source_id=command.request_id, model_id=model_id, draft=True)
            return CanvasAssistantExchange(request_id=command.request_id, text=command.text, context=context,
                sequence=len(command.turns) + 1, model_id=model_id, reply=reply, attachments=attachments,
                canvas_references=command.canvas_references or None,
                skills=skills or None, proposal=proposal, preview=preview, revises=command.revises,
                proposal_issues=(edit_draft.proposal_issues or None) if edit_draft else None, repairs=command.repairs)
        return await complete()

    async def _submit_draft_preview(self, canvas_id, command, sequence):
        """Promote a frozen draft preview without creating a saved canvas."""
        document = CanvasDocument.model_validate(command.context.draft)
        row, preview = await claim_preview(self.db, command.submit_preview_id, canvas_id, None, document,
                                           revision=0, source_id=command.request_id, draft=True)
        await stage_draft_approval(self.db, document, command.request_id, preview.proposal, preview.plan,
                                   origin_id=command.request_id)
        return CanvasAssistantExchange(
            request_id=command.request_id, text=command.text, sequence=sequence, model_id=row.model_id,
            reply='已送审这份预演，请核对并批准需要写入的改动组。',
            proposal=preview.proposal, submitted_preview_id=row.id,
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
