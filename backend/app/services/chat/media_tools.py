"""Bind laboratory generation tools to the active turn and the durable media task."""
import asyncio

from fastapi import HTTPException
from langchain.tools import ToolRuntime, tool
from sqlalchemy import select

from app.core.contracts.generation import (
    GenerationCommand, GenerationDelivery, GenerationModality, GenerationOperation,
    GenerationSubmitRequest, GenerationTarget, GenerationTargetKind, ImageGenerationOperationInput, VideoGenerationOperationInput,
)
from app.core.contracts.media import ImageMediaInput, MediaReference, VideoFrameMediaReferences, VideoMediaInput
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession, ExperimentSessionEvent
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission import GenerationSubmitter
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages
from app.services.studio.media_receipts import media_task_receipts, publish_media_fact
from app.services.studio.session_events import append_session_event
from app.services.task_queries import TaskQueries


class ChatTurnStopped(Exception):
    """The active tool loop was ended through the session stop operation."""

class LaboratoryMediaTools:
    """Keep tool call identity, accepted task and user-visible receipt in the same transaction."""

    def __init__(self, sessions, session_id, turn_id, models, file_ids, owner):
        self.sessions = sessions
        self.session_id = session_id
        self.turn_id = turn_id
        self.owner = owner
        self.models = models
        self.file_ids = set(file_ids)

    async def require_active(self, db):
        session = await db.get(ExperimentSession, self.session_id, with_for_update=True, populate_existing=True)
        if not session or session.active_turn != self.turn_id or (session.chat_execution or {}).get('owner') != self.owner:
            raise ChatTurnStopped()
        return session

    async def execute(self, call_id, name, modality, request, submit_only, *, source_file_id=None):
        identity = {'turn_id': self.turn_id, 'tool_call_id': call_id, 'tool': name, 'model_id': request.model_id,
                    'parameters': request.operation_input.model_dump(mode='json', exclude_none=True)}
        if source_file_id:
            identity['source_file_id'] = source_file_id
        async with self.sessions.begin() as db:
            await self.require_active(db)
            row = await db.scalar(select(ExperimentMessage).where(
                ExperimentMessage.session_id == self.session_id, ExperimentMessage.role == 'task',
                ExperimentMessage.payload['turn_id'].as_string() == self.turn_id,
                ExperimentMessage.payload['tool_call_id'].as_string() == call_id))
            if row is None:
                await append_session_event(db, self.session_id, self.turn_id, 'tool.started', identity)
                args = GenerationCommand(
                    modality=modality, operation=GenerationOperation(request.operation_input.kind),
                    delivery=GenerationDelivery.async_polling,
                    target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id=self.session_id),
                    request=request)
                accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, args)
                task_id = accepted.task_id
                await append_experiment_messages(db, session_id=self.session_id, drafts=[ExperimentMessageDraft(
                    role='task', task_id=task_id, content=name,
                    payload={**identity, 'modality': modality.value, 'submit_only': submit_only})])
                await db.flush()
                await publish_media_fact(db, task_id, self.session_id)
            else:
                task_id = row.task_id
                completed = await db.scalar(select(ExperimentSessionEvent).where(
                    ExperimentSessionEvent.session_id == self.session_id, ExperimentSessionEvent.turn_id == self.turn_id,
                    ExperimentSessionEvent.kind.in_(['tool.completed', 'tool.failed']),
                    ExperimentSessionEvent.payload['tool_call_id'].as_string() == call_id))
                if completed:
                    self.file_ids.update(a['file_id'] for a in completed.payload['artifacts']
                                         if a['media_type'] == 'image' and not a['deleted'])
                    return completed.payload
        while True:
            async with self.sessions.begin() as db:
                await self.require_active(db)
                results = await TaskQueries(db).results([task_id])
                receipt = (await media_task_receipts(db, results))[task_id]
                if submit_only or receipt.status in ('succeeded', 'cancelled', 'failed'):
                    public = {**identity, **receipt.model_dump(mode='json')}
                    failed = receipt.status in ('failed', 'cancelled')
                    await append_session_event(db, self.session_id, self.turn_id,
                                               'tool.failed' if failed else 'tool.completed', public)
                    self.file_ids.update(item.file_id for item in receipt.artifacts if item.media_type == 'image' and not item.deleted)
                    return public
            await asyncio.sleep(0.3)

    def image(self):
        @tool
        async def generate_image(runtime: ToolRuntime, prompt: str, count: int = 1,
                                 reference_file_ids: list[str] | None = None, size: str | None = None,
                                 target_ratio: str | None = None, resolution_profile: str | None = None,
                                 seed: int | None = None, watermark: bool | None = None,
                                 submit_only: bool = False):
            """Generate images from a prompt and optional attached image IDs. Wait for files unless the user asks only to submit."""
            if not self.models.image:
                raise HTTPException(422, 'CHAT_IMAGE_MODEL_REQUIRED')
            ids = reference_file_ids or []
            if any(file_id not in self.file_ids for file_id in ids):
                raise HTTPException(422, 'Unknown image reference')
            request = GenerationSubmitRequest(
                model_id=self.models.image, execution_prompt=prompt,
                media=ImageMediaInput(references=[MediaReference(file_id=value, media_kind='image', ordinal=index)
                                                  for index, value in enumerate(ids)]) if ids else None,
                operation_input=ImageGenerationOperationInput(count=count, size=size, target_ratio=target_ratio,
                    resolution_profile=resolution_profile, seed=seed, watermark=watermark))
            return await self.execute(runtime.tool_call_id, 'generate_image', GenerationModality.image, request, submit_only)

        return generate_image

    def video(self):
        @tool
        async def generate_video(runtime: ToolRuntime, prompt: str, first_frame_id: str | None = None,
                                 seconds: int | None = None, ratio: str = '16:9',
                                 resolution: str | None = None, audio: bool | None = None,
                                 seed: int | None = None, submit_only: bool = False):
            """Generate a video. Pass the attached image ID as first_frame_id to animate it. Wait for the file unless asked only to submit."""
            if not self.models.video:
                raise HTTPException(422, 'CHAT_VIDEO_MODEL_REQUIRED')
            media = None
            if first_frame_id:
                if first_frame_id not in self.file_ids:
                    raise HTTPException(422, 'Unknown first frame')
                media = VideoMediaInput(frames=VideoFrameMediaReferences(
                    first=MediaReference(file_id=first_frame_id, media_kind='image')))
            request = GenerationSubmitRequest(
                model_id=self.models.video, execution_prompt=prompt, media=media,
                operation_input=VideoGenerationOperationInput(
                    ratio=ratio, seconds=seconds, resolution=resolution, audio=audio, seed=seed))
            return await self.execute(runtime.tool_call_id, 'generate_video', GenerationModality.video, request, submit_only)

        return generate_video


def observe_rejected_tool(media):
    """Record tool validation failures even when no generation task was accepted."""
    from langchain.agents.middleware import wrap_tool_call

    async def record(call, detail):
        async with media.sessions.begin() as db:
            await media.require_active(db)
            prior = await db.scalar(select(ExperimentSessionEvent).where(
                ExperimentSessionEvent.session_id == media.session_id, ExperimentSessionEvent.turn_id == media.turn_id,
                ExperimentSessionEvent.payload['tool_call_id'].as_string() == call['id'],
            ).limit(1))
            if prior:
                return
            name = call['name']
            model_id = {'generate_image': media.models.image, 'generate_video': media.models.video}.get(name)
            identity = {'tool_call_id': call['id'], 'tool': name, 'model_id': model_id, 'parameters': call.get('args', {})}
            await append_session_event(db, media.session_id, media.turn_id, 'tool.started', identity)
            await append_session_event(db, media.session_id, media.turn_id, 'tool.failed', {**identity, 'error': detail})
            await append_experiment_messages(db, session_id=media.session_id, drafts=[ExperimentMessageDraft(
                role='assistant', content=detail, status='failed',
                payload={**identity, 'turn_id': media.turn_id, 'tool_error': True})])

    @wrap_tool_call
    async def observe(request, handler):
        try:
            message = await handler(request)
        except HTTPException as exc:
            await record(request.tool_call, exc.detail if isinstance(exc.detail, str) else 'Tool request failed')
            raise
        except ValueError:
            await record(request.tool_call, 'Invalid tool arguments')
            raise
        if getattr(message, 'status', None) == 'error':
            await record(request.tool_call, 'Invalid tool arguments')
        return message
    return observe
