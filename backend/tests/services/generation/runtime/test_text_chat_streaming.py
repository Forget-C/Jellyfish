"""文本 SSE 仅持久化实验消息、不创建异步任务的回归测试。"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock

import pytest
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.contracts.model_provider import ProviderChatEvent
from app.core.db import Base
from app.models.experiment_sessions import ExperimentSession
from app.models.llm import Model, ModelCategoryKey, Provider
from app.models.task import Task
from app.services.generation.runtime import text_chat_streaming


@pytest.mark.asyncio
async def test_text_lab_streams_from_selected_gateway(tmp_path, monkeypatch) -> None:
    from app.dependencies import get_db
    from app.main import app

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'gateway.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(text_chat_streaming, "async_session_maker", sessions)
    requests = []

    def reply(request: httpx.Request) -> httpx.Response:
        requests.append((str(request.url), request.headers["authorization"], json.loads(request.content)))
        return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, text=(
            'data: {"choices":[{"index":0,"delta":{"content":"第一段"},"finish_reason":null}]}\n\n'
            'data: {"choices":[{"index":0,"delta":{"content":"第二段"},"finish_reason":"stop"}]}\n\n'
            'data: [DONE]\n\n'
        ))

    async def db_session():
        async with sessions() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, db_session)
    transport = httpx.MockTransport(reply)
    original_init = httpx.AsyncClient.__init__

    def init_client(self, *args, **kwargs):
        kwargs.setdefault("transport", transport)
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", init_client)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions.begin() as db:
            db.add(Provider(id="custom", name="Custom", provider_key="openai",
                            base_url="https://gateway.test/v1", api_key="gateway-key"))
            db.add(Model(id="custom-text", name="compatible-chat", category=ModelCategoryKey.text,
                         provider_id="custom", params={"temperature": 0.4, "use_responses_api": False}))
            db.add(ExperimentSession(id="gateway-session", lab_type="text"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/studio/labs/text/sessions/gateway-session/stream",
                                         json={"model_id": "custom-text", "content": "你好"})
        assert response.status_code == 200
        assert "event: completed" in response.text
        assert "第一段" in response.text and "第二段" in response.text
        [(url, auth, payload)] = requests
        assert (url, auth) == ("https://gateway.test/v1/chat/completions", "Bearer gateway-key")
        assert payload["model"] == "compatible-chat"
        assert payload["messages"] == [{"role": "user", "content": "你好"}]
        assert payload["temperature"] == 0.4
        assert payload["stream"] is True
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_text_stream_creates_message_without_generation_task(tmp_path, monkeypatch) -> None:
    """SSE 文本运行只写用户消息，run 状态保持在进程内运行时。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'text-stream.db'}", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(text_chat_streaming, "async_session_maker", session_local)
    monkeypatch.setattr(text_chat_streaming, "build_laboratory_chat", AsyncMock(return_value=object()))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        async with session_local() as db:
            db.add(ExperimentSession(id="text-session", lab_type="text"))
            await db.commit()
            run_id, accepted = await text_chat_streaming.create_text_stream_run(
                db, session_id="text-session", model_id="text-model", content="你好"
            )
            await db.commit()

        assert accepted.data.task_id == run_id
        expected = {"version": 1, "prompt": "你好", "model_id": "text-model"}
        assert accepted.data.user_message.payload["input_snapshot"] == expected
        from app.api.v1.routes.studio.experiment_sessions import list_experiment_messages
        async with session_local() as db:
            history = await list_experiment_messages("text-session", db, page=1, page_size=50)
            assert history.data[0].payload["input_snapshot"] == expected
        async with session_local() as db:
            assert list((await db.scalars(select(Task))).all()) == []
        assert await text_chat_streaming.request_text_stream_cancel(
            session_id="text-session", task_id=run_id, reason="user_cancelled"
        )
        assert await text_chat_streaming.reap_expired_text_stream_runs() == []
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_text_lab_replays_accepted_request_after_runtime_is_replaced(tmp_path, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from app.dependencies import get_db
    from app.main import app
    from app.services.generation.runtime.text_streaming import TextStreamingRuntime

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'stream-replay.db'}", future=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(text_chat_streaming, 'async_session_maker', sessions)
    monkeypatch.setattr(text_chat_streaming, '_runtime', TextStreamingRuntime())
    received = []

    class ControlledTextModel:
        async def stream(self, messages):
            received.extend(message["content"] for message in messages)
            yield ProviderChatEvent(kind='delta', text='第一段')
            yield ProviderChatEvent(kind='delta', text='第二段')

    monkeypatch.setattr(text_chat_streaming, 'build_laboratory_chat', AsyncMock(return_value=ControlledTextModel()))

    async def test_db():
        async with sessions() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, test_db)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions.begin() as db:
            db.add(ExperimentSession(id='sse-replay', lab_type='text'))
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            url = '/api/v1/studio/labs/text/sessions/sse-replay/stream'
            body = {'model_id': 'text-model', 'content': '独立的本轮输入'}
            headers = {'Idempotency-Key': 'same-stream'}
            first = await client.post(url, json=body, headers=headers)
            assert first.status_code == 200, first.text
            assert all(event in first.text for event in ['event: accepted', 'event: completed', '第一段', '第二段'])
            monkeypatch.setattr(text_chat_streaming, '_runtime', TextStreamingRuntime())
            replayed = await client.post(url, json=body, headers={**headers, 'Last-Event-ID': '2'})
            assert replayed.status_code == 200, replayed.text
            assert 'event: accepted' not in replayed.text and 'id: 2\n' not in replayed.text
            assert 'id: 3\nevent: delta' in replayed.text and 'id: 4\nevent: completed' in replayed.text
            assert received == ['独立的本轮输入']
            changed = await client.post(url, json={**body, 'content': '另一个输入'}, headers=headers)
            assert changed.status_code == 409, changed.text
            snapshot = (await client.get('/api/v1/studio/experiment-sessions/sse-replay/messages')).json()
            assert snapshot['meta']['session_id'] == 'sse-replay' and snapshot['meta']['cursor'] == 2
            task_id = snapshot['data'][0]['payload']['interaction_run_id']
            late_stop = await client.post(f'/api/v1/studio/labs/text/sessions/sse-replay/runs/{task_id}/cancel', json={})
            assert late_stop.json()['data']['status'] == 'succeeded'
            history = snapshot['data']
            assert [(message['role'], message['content']) for message in history] == [
                ('user', '独立的本轮输入'), ('assistant', '第一段第二段'),
            ]
            concurrent = {'Idempotency-Key': 'concurrent-stream'}
            simultaneous = await asyncio.gather(*[client.post(
                url, json={**body, 'content': '并发请求只运行一次'}, headers=concurrent,
            ) for _ in range(2)])
            assert [item.status_code for item in simultaneous] == [200, 200]
            assert received.count('并发请求只运行一次') == 1
            first_delta = asyncio.Event()

            class InterruptedTextModel:
                async def stream(self, _messages):
                    yield ProviderChatEvent(kind='delta', text='已经送达的前缀')
                    first_delta.set()
                    await asyncio.Future()

            monkeypatch.setattr(text_chat_streaming, 'build_laboratory_chat', AsyncMock(return_value=InterruptedTextModel()))
            interrupted = {'Idempotency-Key': 'interrupted-stream'}
            interrupted_body = {**body, 'content': '恢复未结束的流'}
            original = asyncio.create_task(client.post(url, json=interrupted_body, headers=interrupted))
            try:
                await asyncio.wait_for(first_delta.wait(), timeout=5)
                monkeypatch.setattr(text_chat_streaming, '_runtime', TextStreamingRuntime())
                snapshot = (await client.get('/api/v1/studio/experiment-sessions/sse-replay/messages')).json()['data']
                pending = next(item for item in snapshot if item['content'] == interrupted_body['content'])
                assert pending['payload']['partial_text'] == '已经送达的前缀'
                assert '_stream_partial' not in pending['payload']
                recovered = await client.post(url, json=interrupted_body, headers=interrupted)
                assert recovered.status_code == 200
                assert '已经送达的前缀' in recovered.text and 'event: error' in recovered.text
                assert 'event: completed' not in recovered.text
                resumed = await client.post(url, json=interrupted_body, headers={**interrupted, 'Last-Event-ID': '2'})
                assert resumed.status_code == 200 and 'id: 3\nevent: error' in resumed.text
                assert 'event: delta' not in resumed.text
                history = (await client.get('/api/v1/studio/experiment-sessions/sse-replay/messages')).json()['data']
                assert sum(message.get('payload', {}).get('partial_text') == '已经送达的前缀' for message in history) == 1
                assert not any(message['content'] == '已经送达的前缀' for message in history)
                assert 'stream_result_unknown' in recovered.text
            finally:
                original.cancel()
                await asyncio.gather(original, return_exceptions=True)

    finally:
        await engine.dispose()
