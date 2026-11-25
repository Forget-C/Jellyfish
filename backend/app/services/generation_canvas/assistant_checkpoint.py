"""Store LangGraph checkpoints for the one leased request on each canvas."""

import asyncio
from datetime import UTC, datetime
from hashlib import sha256
from zlib import compress, decompress

from fastapi import HTTPException
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.canvas_assistant import CanvasAssistantSession
from app.schemas.canvas_assistant import CanvasAssistantExchange, CanvasAssistantProgress
from app.services.generation_canvas.assistant_events import publish_events

CHECKPOINT_LIMIT = 8 * 1024 * 1024
CHECKPOINT_DATA_LIMIT = 32 * 1024 * 1024
MEDIA_KEY = '__jellyfish_canvas_checkpoint_media__'


class CheckpointMediaUnavailable(ValueError):
    """A previously resolved media block cannot be reconstructed unchanged."""


class CanvasCheckpointSerializer(JsonPlusSerializer):
    """Keep checkpoint URLs as digests and re-resolve private bytes on retry."""

    def __init__(self, content, *, redact_missing=False):
        super().__init__()
        self._redact_missing = redact_missing
        urls = (
            block[block['type']].get('url') for block in content
            if isinstance(block, dict) and block.get('type') in ('image_url', 'video_url', 'audio_url')
        ) if isinstance(content, list) else ()
        self._media = {sha256(url.encode()).hexdigest(): url for url in urls if url and url.startswith('data:')}

    def _map_media(self, value, *, restore):
        if isinstance(value, BaseMessage):
            return value.model_copy(update={'content': self._map_media(value.content, restore=restore)})
        if isinstance(value, dict):
            if restore and MEDIA_KEY in value and len(value) == 1:
                url = self._media.get(value[MEDIA_KEY])
                if url is None and not self._redact_missing:
                    raise CheckpointMediaUnavailable('Assistant checkpoint media has changed')
                return url if url is not None else value
            return {key: self._map_media(item, restore=restore) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            mapped = [self._map_media(item, restore=restore) for item in value]
            return tuple(mapped) if isinstance(value, tuple) else mapped
        if not restore and isinstance(value, str) and value.startswith('data:'):
            digest = sha256(value.encode()).hexdigest()
            if digest in self._media:
                return {MEDIA_KEY: digest}
        return value

    def dumps_typed(self, obj):
        return super().dumps_typed(self._map_media(obj, restore=False))

    def loads_typed(self, data):
        return self._map_media(super().loads_typed(data), restore=True)


class CanvasGraphSnapshot(InMemorySaver):
    """Serialize the graph state with private media replaced by evidence digests."""

    def __init__(self, request_id, snapshot, content=None, *, redact_missing=False):
        super().__init__(serde=CanvasCheckpointSerializer(content, redact_missing=redact_missing))
        self._serialize = JsonPlusSerializer()
        self.config = {'configurable': {'thread_id': request_id}}
        if snapshot:
            self._restore(snapshot)

    def _restore(self, snapshot):
        codec, payload = snapshot.split(b'\0', 1)
        storage, writes, blobs = self._serialize.loads_typed((codec.decode(), decompress(payload)))
        for thread, namespaces in storage.items():
            self.storage[thread].update(namespaces)
        for key, inner in writes:
            self.writes[tuple(key)] = {tuple(index): value for index, value in inner}
        self.blobs.update((tuple(key), value) for key, value in blobs)

    def snapshot(self):
        """Encode the bounded graph checkpoint for durable storage."""
        payload = (self.storage, [(key, list(inner.items())) for key, inner in self.writes.items()], list(self.blobs.items()))
        codec, data = self._serialize.dumps_typed(payload)
        if len(data) > CHECKPOINT_DATA_LIMIT:
            raise HTTPException(422, 'Canvas assistant checkpoint exceeds the turn limit')
        snapshot = codec.encode() + b'\0' + compress(data, 1)
        if len(snapshot) > CHECKPOINT_LIMIT:
            raise HTTPException(422, 'Canvas assistant checkpoint exceeds the turn limit')
        return snapshot


class CanvasCheckpointer(CanvasGraphSnapshot):
    """Flush the pinned LangGraph saver state before releasing each step."""

    def __init__(self, db, canvas_id, request_id, token, snapshot, content):
        super().__init__(request_id, snapshot, content)
        self._sessions = async_sessionmaker(bind=db.bind, expire_on_commit=False)
        self._canvas_id, self._token = canvas_id, token
        self._lock = asyncio.Lock()

    @staticmethod
    async def _commit(db):
        """Let an in-flight database commit settle before cancellation unwinds the request."""
        commit = asyncio.create_task(db.commit())
        try:
            await asyncio.shield(commit)
        except asyncio.CancelledError:
            await asyncio.gather(commit, return_exceptions=True)
            raise

    async def _flush(self):
        async with self._sessions() as db:
            snapshot = self.snapshot()
            result = await db.execute(update(CanvasAssistantSession).where(
                CanvasAssistantSession.canvas_id == self._canvas_id,
                CanvasAssistantSession.pending_token == self._token,
            ).values(pending_checkpoint=snapshot).execution_options(synchronize_session=False))
            await self._commit(db)
            if not result.rowcount:
                raise HTTPException(409, 'Canvas assistant reply lease expired')

    async def report_tool(self, **call):
        """Commit a public tool identity before the next model step."""
        await self.report_progress(tool_call=call)

    async def report_progress(self, **changes):
        """Commit observed facts only while this execution owns the turn lease."""
        async with self._lock, self._sessions() as db:
            session = await db.get(CanvasAssistantSession, self._canvas_id, with_for_update=True, populate_existing=True)
            if session is None or session.pending_token != self._token:
                await db.rollback()
                raise HTTPException(409, 'Canvas assistant reply lease expired')
            pending = session.pending_request
            previous = pending.get('progress') or {}
            active_tasks = dict(previous.get('active_tasks', {}))
            if task := changes.pop('started_task', None):
                active_tasks[task[0]] = task[1]
            if completed := changes.pop('finished_task', None):
                active_tasks.pop(completed['id'], None)
                changes['subtasks'] = [*previous.get('subtasks', []), completed]
            if observed := changes.pop('observed', None):
                changes['observed_card_ids'] = list(dict.fromkeys([*previous.get('observed_card_ids', []), *observed]))
            if (phase := changes.get('phase')) and phase != previous.get('phase'):
                changes['phase_started_at'] = {**previous.get('phase_started_at', {}), phase: datetime.now(UTC)}
            progress = CanvasAssistantProgress.model_validate({
                **previous, **changes, 'active_tasks': active_tasks, 'streaming': True,
                'request_id': pending['command']['request_id'], 'model_id': pending['model_id'],
            })
            value = progress.model_dump(mode='json')
            if previous != value:
                session.pending_request = {**pending, 'progress': value}
                event = 'turn.progress'
                if 'tool_call' in changes:
                    event = f"tool.{changes['tool_call']['state']}"
                elif 'reply' in changes:
                    event = 'message.updated'
                publish_events(db, session, CanvasAssistantExchange(
                    request_id=progress.request_id, text=pending['command']['text'], sequence=session.sequence + 1,
                    model_id=progress.model_id, reply='', progress=progress,
                ), event)
            await self._commit(db)

    async def save_canvas_preview(self, preview):
        """Retain server-validated plans separately from model ToolMessage data."""
        async with self._lock, self._sessions() as db:
            session = await db.get(CanvasAssistantSession, self._canvas_id, with_for_update=True, populate_existing=True)
            if session is None or session.pending_token != self._token:
                raise HTTPException(409, 'Canvas assistant reply lease expired')
            session.pending_request = {**session.pending_request, 'validated_preview': preview.model_dump(mode='json')}
            await self._commit(db)

    async def save_delegation(self, identity, receipt):
        """Commit one completed specialist result while this turn still owns its lease."""
        async with self._lock, self._sessions() as db:
            session = await db.get(CanvasAssistantSession, self._canvas_id, with_for_update=True, populate_existing=True)
            if session is None or session.pending_token != self._token:
                await db.rollback()
                raise HTTPException(409, 'Canvas assistant reply lease expired')
            pending = session.pending_request
            session.pending_request = {**pending, 'delegations': {**pending.get('delegations', {}), identity: receipt}}
            await self._commit(db)

    async def aput(self, config, checkpoint, metadata, new_versions):
        async with self._lock:
            current = self.put(config, checkpoint, metadata, new_versions)
            await self._flush()
            return current

    async def aput_writes(self, config, writes, task_id, task_path=''):
        async with self._lock:
            self.put_writes(config, writes, task_id, task_path)
            await self._flush()
