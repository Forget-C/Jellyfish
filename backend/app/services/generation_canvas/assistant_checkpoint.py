"""Store LangGraph checkpoints for the one leased request on each canvas."""

import asyncio
from hashlib import sha256
from zlib import compress, decompress

from fastapi import HTTPException
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from sqlalchemy import update

from app.models.canvas_assistant import CanvasAssistantSession

CHECKPOINT_LIMIT = 8 * 1024 * 1024
MEDIA_KEY = '__jellyfish_canvas_checkpoint_media__'


class CheckpointMediaUnavailable(ValueError):
    """A previously resolved media block cannot be reconstructed unchanged."""


class CanvasCheckpointSerializer(JsonPlusSerializer):
    """Keep checkpoint URLs as digests and re-resolve private bytes on retry."""

    def __init__(self, content):
        super().__init__()
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
                if (url := self._media.get(value[MEDIA_KEY])) is None:
                    raise CheckpointMediaUnavailable('Assistant checkpoint media has changed')
                return url
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


class CanvasCheckpointer(InMemorySaver):
    """Flush the pinned LangGraph saver state before releasing each step."""

    def __init__(self, db, canvas_id, request_id, token, snapshot, content):
        super().__init__(serde=CanvasCheckpointSerializer(content))
        self._db, self._canvas_id, self._token = db, canvas_id, token
        self._serialize = JsonPlusSerializer()
        self._lock = asyncio.Lock()
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

    async def _flush(self):
        payload = (self.storage, [(key, list(inner.items())) for key, inner in self.writes.items()], list(self.blobs.items()))
        codec, data = self._serialize.dumps_typed(payload)
        snapshot = codec.encode() + b'\0' + compress(data, 1)
        if len(snapshot) > CHECKPOINT_LIMIT:
            raise HTTPException(422, 'Canvas assistant checkpoint exceeds the turn limit')
        result = await self._db.execute(update(CanvasAssistantSession).where(
            CanvasAssistantSession.canvas_id == self._canvas_id,
            CanvasAssistantSession.pending_token == self._token,
        ).values(pending_checkpoint=snapshot).execution_options(synchronize_session=False))
        await self._db.commit()
        if not result.rowcount:
            raise HTTPException(409, 'Canvas assistant reply lease expired')

    async def aput(self, config, checkpoint, metadata, new_versions):
        async with self._lock:
            current = self.put(config, checkpoint, metadata, new_versions)
            await self._flush()
            return current

    async def aput_writes(self, config, writes, task_id, task_path=''):
        async with self._lock:
            self.put_writes(config, writes, task_id, task_path)
            await self._flush()
