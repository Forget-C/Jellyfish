"""Keep unsaved free canvas conversations in the browser until first save."""

import asyncio
from datetime import UTC, datetime
from hashlib import sha256

from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import ValidationError

from app.models.canvas_assistant import CanvasAssistantSession, CanvasAssistantTurn
from app.models.generation_canvas import GenerationCanvas
from app.schemas.canvas_assistant import CanvasAssistantExchange, CanvasAssistantProgress
from app.schemas.canvas_assistant_edit import CanvasAssistantProposal
from app.schemas.canvas_assistant_draft import CanvasDraftSave, DraftAssistantMessage, DraftAssistantReply
from app.schemas.canvas_assistant_structure import AddCanvasCardTarget, ConnectCardsTarget
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.allowed_cards import FREE_CARD_TYPES
from app.services.generation_canvas.assistant import CanvasAssistant, MODEL_FAILED, MODEL_FAILURE_REPLIES, MODEL_TIMEOUT, PROPOSAL_INVALID, PROPOSAL_RETRY_GUIDANCE, prepare_proposal_repair
from app.services.generation_canvas.assistant_context import resolve_assistant_context, resolve_external_canvas_cards
from app.services.generation_canvas.assistant_edits import CanvasAssistantEditDraft
from app.services.generation_canvas.assistant_events import publish_events
from app.services.generation_canvas.assistant_media import (
    describe_assistant_media, resolve_assistant_media, retain_assistant_media,
)
from app.services.generation_canvas.assistant_structure import (
    apply_structural_change, assistant_card_configuration, structural_preview_tool,
)


# Unsaved conversations stay browser-owned. Keep an in-flight response and a short
# reconnect window on this API process; first save still uses the browser transcript.
_draft_replies = {}


def draft_reply_snapshot(canvas_id, request_id, *, stop=False):
    record = _draft_replies.get((canvas_id, request_id))
    if record is None:
        raise HTTPException(404, 'Draft reply unavailable')
    snapshot, task, _ = record
    if stop and snapshot.state == 'running':
        snapshot.turn.stopped = True
        snapshot.state = 'stopped'
        task.cancel()
    return snapshot


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
            context = resolve_assistant_context(canvas, command.context, command.text)
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
                    client, messages, context, edit_draft, supports_tools=capability.tool_calling, structure_tool=structure_tool,
                    max_input_tokens=capability.max_input_tokens, on_reply=on_reply, on_phase=on_phase,
                )
            except HTTPException as error:
                if not isinstance(error.detail, str) or error.detail not in MODEL_FAILURE_REPLIES:
                    raise
                reply = '\n\n'.join(filter(None, [partial_reply(), MODEL_FAILURE_REPLIES[error.detail]]))
                skills, observed = [], None
            if context is not None:
                context.observed_card_ids = observed
            return CanvasAssistantExchange(request_id=command.request_id, text=command.text, context=context,
                sequence=len(command.turns) + 1, model_id=model_id, reply=reply, attachments=attachments,
                canvas_references=command.canvas_references or None,
                skills=skills or None, proposal=edit_draft.proposal if edit_draft else None, revises=command.revises,
                proposal_issues=(edit_draft.proposal_issues or None) if edit_draft else None, repairs=command.repairs)
        if not command.stream_reply:
            return await complete()
        key = canvas_id, command.request_id
        digest = sha256(command.model_dump_json().encode()).digest()
        if existing := _draft_replies.get(key):
            snapshot, _, original = existing
            if digest != original or snapshot.state == 'running':
                raise HTTPException(409, 'Draft assistant request already active or changed')
            if snapshot.state != 'interrupted':
                return snapshot.turn
            if snapshot.turn.error_code == PROPOSAL_INVALID:
                messages[-1] = HumanMessage(content=(
                    content + '\n\n' + PROPOSAL_RETRY_GUIDANCE if isinstance(content, str)
                    else [*content, {'type': 'text', 'text': PROPOSAL_RETRY_GUIDANCE}]
                ))
        snapshot = DraftAssistantReply(state='running', turn=CanvasAssistantExchange(
            request_id=command.request_id, text=command.text, model_id=model_id, sequence=len(turns) + 1, reply='',
            progress=CanvasAssistantProgress(request_id=command.request_id, model_id=model_id, streaming=True),
        ))

        async def publish(text):
            snapshot.turn.reply = text

        async def publish_phase(phase):
            progress = snapshot.turn.progress
            progress.phase = phase
            progress.phase_started_at[phase] = datetime.now(UTC)

        task = asyncio.create_task(complete(publish, publish_phase, lambda: snapshot.turn.reply))
        record = snapshot, task, digest
        _draft_replies[key] = record

        def expire():
            if _draft_replies.get(key) is record:
                _draft_replies.pop(key)
        try:
            snapshot.turn = await task
            snapshot.state = 'completed'
        except asyncio.CancelledError:
            if snapshot.state != 'stopped':
                snapshot.state = 'interrupted'
                raise
        except HTTPException as error:
            snapshot.state = 'interrupted'
            snapshot.turn.error_code = error.detail if error.detail in (PROPOSAL_INVALID, MODEL_TIMEOUT) else MODEL_FAILED
            raise
        except Exception:
            snapshot.state = 'interrupted'
            snapshot.turn.error_code = MODEL_FAILED
            raise
        finally:
            asyncio.get_running_loop().call_later(900, expire)
        return snapshot.turn


def _valid_free_card(target: AddCanvasCardTarget, card_id: str) -> bool:
    try:
        card, _ = assistant_card_configuration(target.card, card_id)
    except ValueError:
        return False
    return card.type in FREE_CARD_TYPES


def _valid_proposal(proposal: CanvasAssistantProposal | None) -> bool:
    """Check that a browser-owned first-save proposal only adds independent free-canvas groups."""
    groups = proposal.groups if proposal else None
    if not groups or len({group.id for group in groups}) != len(groups):
        return False
    added = set()
    for group in groups:
        local = set()
        for edit in group.edits:
            target = edit.target
            if isinstance(target, AddCanvasCardTarget):
                if edit.card_id in added or not _valid_free_card(target, edit.card_id):
                    return False
                local.add(edit.card_id)
                added.add(edit.card_id)
            elif (not isinstance(target, ConnectCardsTarget) or edit.card_id != target.target_card
                  or {target.source_card, target.target_card} - local):
                return False
        if not local:
            return False
    return True


async def prepare_draft_approval(store, canvas, command: CanvasDraftSave):
    """Apply selected independent groups in the same transaction as the new canvas."""
    approval = command.assistant_approval
    if approval is None:
        return None
    turns = command.assistant.validated_turns() if command.assistant else ()
    selected = next((turn for turn in turns if turn.request_id == approval.source_id), None)
    proposal = selected.proposal if selected else None
    if not _valid_proposal(proposal):
        raise HTTPException(422, 'Select a draft card creation proposal')
    pending = {group.id for group in proposal.groups if group.state == 'pending'}
    selected_ids = set(approval.group_ids)
    if (proposal.state != 'pending' or len(selected_ids) != len(approval.group_ids)
            or not selected_ids <= pending):
        raise HTTPException(409, 'The draft assistant proposal cannot be approved')
    try:
        document = CanvasDocument.model_validate(command.document)
    except ValidationError as error:
        raise HTTPException(422, 'Invalid draft canvas document') from error
    for group in proposal.groups:
        if group.id in selected_ids:
            for edit in group.edits:
                if not await apply_structural_change(store, canvas, document, edit):
                    raise HTTPException(409, 'The proposed card or connection is no longer valid')
    return document.model_dump(mode='json')


async def attach_draft_conversation(store, command: CanvasDraftSave, receipt: dict):
    """Publish the transcript and asset usages in the first-save transaction."""
    conversation = command.assistant
    if not conversation or not conversation.turns:
        return
    canvas_id = receipt['canvas_id']
    session = CanvasAssistantSession(canvas_id=canvas_id, sequence=len(conversation.turns), model_id=conversation.model_id)
    store.db.add(session)
    await store.db.flush()
    turns = conversation.validated_turns()
    files = {item.file_id for turn in turns for item in (turn.attachments or [])}
    sources = await resolve_assistant_media(store.db, None, sorted(files))
    await retain_assistant_media(store.db, None, canvas_id, sources)
    approval = command.assistant_approval
    for turn in turns:
        proposal = turn.proposal if _valid_proposal(turn.proposal) else None
        approved = bool(approval and turn.request_id == approval.source_id)
        if proposal and (approved or proposal.state == 'applied' or any(
            group.state == 'applied' for group in proposal.groups
        )):
            for group in proposal.groups:
                if approved and group.id in approval.group_ids:
                    group.state = 'applied'
                elif group.state == 'applied':
                    group.state = 'pending'
            states = {group.state for group in proposal.groups}
            proposal.state = 'pending' if 'pending' in states else 'applied' if 'applied' in states else 'rejected'
        audit = [{'source_id': turn.request_id, 'mode': 'manual', 'action': 'approve',
                  'outcome': 'applied', 'group_ids': approval.group_ids}] if approved else None
        store.db.add(CanvasAssistantTurn(canvas_id=canvas_id, request_id=turn.request_id, sequence=turn.sequence,
            model_id=turn.model_id, text=turn.text, reply=turn.reply, revises=turn.revises, repairs=turn.repairs,
            context=turn.context.model_dump(mode='json') if turn.context else None,
            skills=[skill.model_dump(mode='json') for skill in (turn.skills or [])],
            canvas_references=[item.model_dump(mode='json') for item in turn.canvas_references] if turn.canvas_references else None,
            attachments=[item.model_dump(mode='json') for item in (turn.attachments or [])
                         if item.file_id in sources],
            proposal=proposal.model_dump(mode='json') if proposal else None, approval_audit=audit,
            proposal_issues=[issue.model_dump(mode='json') for issue in (turn.proposal_issues or [])] or None))
        exchange = CanvasAssistantExchange.model_validate({
            **turn.model_dump(mode='json'), 'proposal': proposal, 'approval_audit': audit,
        })
        publish_events(store.db, session, exchange, 'turn.completed')
    await store.db.flush()
