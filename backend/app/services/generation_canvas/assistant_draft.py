"""Keep unsaved free canvas conversations in the browser until first save."""

from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import ValidationError

from app.models.canvas_assistant import CanvasAssistantSession, CanvasAssistantTurn
from app.models.generation_canvas import GenerationCanvas
from app.schemas.canvas_assistant import CanvasAssistantExchange
from app.schemas.canvas_assistant_draft import CanvasDraftSave, DraftAssistantMessage
from app.schemas.canvas_assistant_structure import AddCanvasCardTarget, AddModelCard, AddTextCard
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.assistant import CanvasAssistant
from app.services.generation_canvas.assistant_context import resolve_assistant_context
from app.services.generation_canvas.assistant_edits import CanvasAssistantEditDraft
from app.services.generation_canvas.assistant_media import (
    describe_assistant_media, resolve_assistant_media, retain_assistant_media,
)
from app.services.generation_canvas.assistant_structure import apply_structural_change, structural_preview_tool


class DraftCanvasAssistant(CanvasAssistant):
    """Use the same model and tools for a browser-owned transcript."""

    async def reply_to_draft(self, canvas_id: str, command: DraftAssistantMessage) -> CanvasAssistantExchange:
        """Read the browser snapshot, without creating a canvas or session."""
        if await self.db.get(GenerationCanvas, canvas_id) is not None:
            raise HTTPException(409, 'The draft has already been saved')
        turns = command.validated_turns()
        if len(turns) == 100 or any(turn.request_id == command.request_id for turn in turns):
            raise HTTPException(422, 'The draft assistant transcript is full or contains this request')
        empty = CanvasDocument(id=canvas_id, name='未命名画布')
        context, edit_draft = None, None
        if command.context:
            canvas = GenerationCanvas(id=canvas_id, kind='free', revision=0)
            context = resolve_assistant_context(canvas, command.context)
            edit_draft = CanvasAssistantEditDraft(context, empty, CanvasDocument.model_validate(command.context.draft))
        model, provider, capability = await self._resolve_model(command.model_id)
        client = await self._model_client(model, provider, capability)
        model_id = model.id
        sources = await resolve_assistant_media(self.db, None, command.attachment_file_ids)
        structure_tool = structural_preview_tool(edit_draft, 'free', sources) if edit_draft else None
        await self.db.rollback()
        messages = []
        for turn in turns:
            messages.extend([HumanMessage(content=turn.text), AIMessage(content=turn.reply)])
        content, attachments = await describe_assistant_media(
            command.text, command.attachment_file_ids, sources, capability=capability,
        )
        messages.append(HumanMessage(content=content))
        reply, skills = await self._reply(
            client, messages, context, edit_draft, supports_tools=capability.tool_calling, structure_tool=structure_tool,
            max_input_tokens=capability.max_input_tokens,
        )
        return CanvasAssistantExchange(request_id=command.request_id, text=command.text, context=context,
            sequence=len(command.turns) + 1, model_id=model_id, reply=reply, attachments=attachments,
            skills=skills or None, proposal=edit_draft.proposal if edit_draft else None, revises=command.revises)


def _valid_proposal(proposal) -> bool:
    """Unsaved conversations can only bring forward proposed card creation."""
    if not proposal or not proposal.groups or len(proposal.groups) != 1 or len(proposal.groups[0].edits) != 1:
        return False
    target = proposal.groups[0].edits[0].target
    return isinstance(target, AddCanvasCardTarget) and isinstance(target.card, (AddTextCard, AddModelCard))


async def prepare_draft_approval(store, canvas, command: CanvasDraftSave):
    """Apply only the selected card creation to the first-save document."""
    approval = command.assistant_approval
    if approval is None:
        return None
    turns = command.assistant.validated_turns() if command.assistant else ()
    selected = next((turn for turn in turns if turn.request_id == approval.source_id), None)
    proposal = selected.proposal if selected else None
    if not _valid_proposal(proposal):
        raise HTTPException(422, 'Select a draft card creation proposal')
    group, = proposal.groups
    if approval.group_ids != [group.id] or proposal.state != 'pending' or group.state != 'pending':
        raise HTTPException(409, 'The draft assistant proposal cannot be approved')
    try:
        document = CanvasDocument.model_validate(command.document)
    except ValidationError as error:
        raise HTTPException(422, 'Invalid draft canvas document') from error
    edit, = group.edits
    if not await apply_structural_change(store, canvas, document, edit):
        raise HTTPException(409, 'The proposed card already exists')
    return document.model_dump(mode='json')


async def attach_draft_conversation(store, command: CanvasDraftSave, receipt: dict):
    """Publish the transcript and asset usages in the first-save transaction."""
    conversation = command.assistant
    if not conversation or not conversation.turns:
        return
    canvas_id = receipt['canvas_id']
    store.db.add(CanvasAssistantSession(canvas_id=canvas_id, sequence=len(conversation.turns),
                                        model_id=conversation.model_id))
    await store.db.flush()
    turns = conversation.validated_turns()
    files = {item.file_id for turn in turns for item in (turn.attachments or [])}
    sources = await resolve_assistant_media(store.db, None, sorted(files))
    await retain_assistant_media(store.db, None, canvas_id, sources)
    approval = command.assistant_approval
    for turn in turns:
        proposal = turn.proposal if _valid_proposal(turn.proposal) else None
        approved = bool(approval and turn.request_id == approval.source_id)
        if proposal and approved:
            proposal.state = proposal.groups[0].state = 'applied'
        elif proposal and proposal.state == 'applied':
            proposal.state = proposal.groups[0].state = 'pending'
        audit = [{'source_id': turn.request_id, 'mode': 'manual', 'action': 'approve',
                  'outcome': 'applied', 'group_ids': approval.group_ids}] if approved else None
        store.db.add(CanvasAssistantTurn(canvas_id=canvas_id, request_id=turn.request_id, sequence=turn.sequence,
            model_id=turn.model_id, text=turn.text, reply=turn.reply, revises=turn.revises,
            context=turn.context.model_dump(mode='json') if turn.context else None,
            skills=[skill.model_dump(mode='json') for skill in (turn.skills or [])],
            attachments=[item.model_dump(mode='json') for item in (turn.attachments or [])
                         if item.file_id in sources],
            proposal=proposal.model_dump(mode='json') if proposal else None, approval_audit=audit))
    await store.db.flush()
