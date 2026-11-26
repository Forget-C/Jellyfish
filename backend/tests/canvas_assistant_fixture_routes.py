"""Synchronous domain adapters for isolated canvas fixtures."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from langchain_core.messages import AIMessage, HumanMessage
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.dependencies import get_db
from app.schemas.canvas_assistant import (
    CanvasAssistantEventPayload, CanvasAssistantExchange, CanvasAssistantMessage, CanvasAssistantQuestionAnswer,
)
from app.schemas.canvas_assistant_draft import DraftAssistantConversation
from app.schemas.common import ApiResponse, success_response
from app.schemas.interaction import InteractionEvent
from app.models.generation_canvas import GenerationCanvas
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.assistant import CanvasAssistant, MODEL_FAILURE_REPLIES, prepare_proposal_repair
from app.services.generation_canvas.assistant_context import resolve_assistant_context, resolve_external_canvas_cards
from app.services.generation_canvas.assistant_edits import CanvasAssistantEditDraft
from app.services.generation_canvas.assistant_media import describe_assistant_media, resolve_assistant_media
from app.services.generation_canvas.assistant_preview_submission import claim_preview, retain_preview
from app.services.generation_canvas.assistant_structure import structural_preview_tool
from app.services.generation_canvas.draft_canvas_approvals import draft_approval_origin, stage_draft_approval
from app.services.generation_canvas.model_adapter import CanvasModelAdapter
from app.services.generation_canvas.planning_tools import CanvasPlanningTools

class DraftAssistantMessage(CanvasAssistantMessage, DraftAssistantConversation):
    """Prepare historical draft transcripts for migration tests."""


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


router = APIRouter()


@router.post('/drafts/{canvas_id}/assistant', response_model=ApiResponse[CanvasAssistantExchange],
             operation_id='canvas_draft_assistant_send')
async def send_draft_assistant_message(canvas_id: UUID, body: DraftAssistantMessage,
                                       db: AsyncSession = Depends(get_db, scope='function')):
    """Reply to a browser-owned free canvas conversation without saving it."""
    return success_response(await DraftCanvasAssistant(db, '').reply_to_draft(str(canvas_id), body))


@router.get('/{canvas_id}/assistant/events',
            response_model=ApiResponse[list[InteractionEvent[CanvasAssistantEventPayload]]],
            operation_id='canvas_assistant_events')
async def get_assistant_events(canvas_id: str, after: Annotated[int, Query(ge=0)] = 0, project_id: str = '',
                               db: AsyncSession = Depends(get_db, scope='function')):
    """Read the next page of committed assistant events for a saved canvas."""
    events = await CanvasAssistant(db, project_id).events(canvas_id, after)
    progress_kinds = {'turn.accepted', 'tool.started', 'tool.completed', 'tool.failed', 'message.updated'}
    return success_response([event.model_copy(update={'type': 'turn.progress'}) if event.type in progress_kinds
                             else event for event in events])


@router.post('/{canvas_id}/assistant', response_model=ApiResponse[CanvasAssistantExchange],
             operation_id='canvas_assistant_send')
async def send_assistant_message(canvas_id: str, body: CanvasAssistantMessage, project_id: str = '',
                                 db: AsyncSession = Depends(get_db, scope='function')):
    """Send a turn, replaying the receipt when the request already succeeded."""
    return success_response(await CanvasAssistant(db, project_id).send(canvas_id, body))


@router.post('/{canvas_id}/assistant/turns/{source_id}/answer', response_model=ApiResponse[CanvasAssistantExchange],
             operation_id='canvas_assistant_answer')
async def answer_assistant_question(canvas_id: str, source_id: str, body: CanvasAssistantQuestionAnswer,
                                    project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """Resume a paused creative question on its original canvas assistant turn."""
    return success_response(await CanvasAssistant(db, project_id).answer(canvas_id, source_id, body))
