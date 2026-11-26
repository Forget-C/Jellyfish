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
@pytest.mark.parametrize("responses", [False, True, "failed", "disabled"])
async def test_text_lab_streams_from_selected_gateway(tmp_path, monkeypatch, responses) -> None:
    from app.dependencies import get_db
    from app.main import app

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'gateway.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(text_chat_streaming, "async_session_maker", sessions)
    requests = []

    def reply(request: httpx.Request) -> httpx.Response:
        requests.append((str(request.url), request.headers["authorization"], json.loads(request.content)))
        if responses:
            events = [{"type": "response.output_text.delta", "delta": text} for text in ("第一段", "第二段")]
            events.append({"type": "response.failed" if responses == "failed" else "response.completed",
                           "response": {"status": "failed" if responses == "failed" else "completed"}})
            return httpx.Response(200, headers={"Content-Type": "text/event-stream"},
                                  text="".join("data: " + json.dumps(event) + "\n\n" for event in events))
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
                         provider_id="custom", capability_profile={"native_streaming": {"declaration": "unsupported"}} if responses == "disabled" else {}, params={"temperature": 0.4, "use_responses_api": bool(responses)}))
            db.add(ExperimentSession(id="gateway-session", lab_type="text"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            base = "/api/v1/studio/chat/sessions/gateway-session"
            url = base + "/turns"
            body = {"model_id": "custom-text", "content": "你好"}
            response = await client.post(url, json=body, headers={"Idempotency-Key": "gateway-trial"})
            if responses != "disabled":
                assert response.status_code == 202, response.text
                receipt = response.json()['data']
                assert receipt['session_id'] == 'gateway-session' and 'result' not in receipt
                retry = await client.post(url, json=body, headers={"Idempotency-Key": "gateway-trial"})
                assert retry.json()['data'] == receipt
                for _ in range(100):
                    response = await client.get(base + "/events", params={"after": receipt['cursor'], "follow": False})
                    if "event: turn.completed" in response.text or "event: turn.failed" in response.text:
                        break
                    await asyncio.sleep(.02)
                events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
                assert events[0]['type'] == 'turn.accepted'
                assert events[0]['category'] == 'turn' and events[0]['payload']['message']['content'] == '你好'
                assert {e['turn_id'] for e in events} == {receipt['turn_id']}
                assert [(e['payload']['mode'], e['payload']['text']) for e in events if e['type'] == 'message.updated'] == [('append', '第一段'), ('append', '第二段')]
                replay = await client.get(base + "/events", params={"after": events[-2]['cursor'], "follow": False})
                assert replay.text.count("data: ") == 1
                snapshot = await client.get("/api/v1/studio/chat/sessions/text/gateway-session")
                assert snapshot.json()['data'][0]['content'] == '你好'
        if responses == "disabled":
            assert response.status_code == 422 and not requests
            return
        assert response.status_code == 200
        if responses == "failed":
            assert "event: turn.failed" in response.text
            return
        assert "event: turn.completed" in response.text
        assert "第一段" in response.text and "第二段" in response.text
        [(url, auth, payload)] = requests
        assert (url, auth) == ("https://gateway.test/v1/" + ("responses" if responses else "chat/completions"), "Bearer gateway-key")
        assert payload["model"] == "compatible-chat"
        assert payload["input" if responses else "messages"] == [{"role": "user", "content": "你好"}]
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
            from tests.chat_events import wait_for_chat_event

            session_url = '/api/v1/studio/chat/sessions/text/sse-replay'
            url = session_url + '/turns'
            body = {'model_id': 'text-model', 'content': '独立的本轮输入'}
            headers = {'Idempotency-Key': 'same-stream'}
            first = await client.post(url, json=body, headers=headers)
            assert first.status_code == 202, first.text
            receipt = first.json()['data']
            completed = await wait_for_chat_event(client, session_url, receipt['turn_id'], 'turn.completed')
            monkeypatch.setattr(text_chat_streaming, '_runtime', TextStreamingRuntime())
            replayed = await client.post(url, json=body, headers=headers)
            assert replayed.json() == first.json()
            replay = await client.get(session_url + '/events', params={'follow': False},
                                      headers={'Last-Event-ID': str(completed['cursor'] - 1)})
            assert 'event: message.updated' not in replay.text
            assert 'event: turn.completed' in replay.text and '第一段第二段' in replay.text
            compatibility = '/api/v1/studio/chat/sessions/sse-replay'
            compatibility_retry = await client.post(compatibility + '/turns', json=body, headers=headers)
            assert compatibility_retry.json() == first.json()
            compat_stream = await client.get(compatibility + '/events',
                                             params={'follow': False, 'after': completed['cursor'] - 1})
            assert compat_stream.text == replay.text
            # Historical rows written before the unified event log can still be retried.
            from sqlalchemy import delete
            from app.models.experiment_sessions import ExperimentSessionEvent

            async with sessions.begin() as db:
                await db.execute(delete(ExperimentSessionEvent).where(
                    ExperimentSessionEvent.session_id == 'sse-replay',
                    ExperimentSessionEvent.turn_id == receipt['turn_id']))
            migrated = await client.post(url, json=body, headers=headers)
            assert migrated.status_code == 202
            assert migrated.json()['data']['turn_id'] == receipt['turn_id']
            assert (await client.post(url, json=body, headers=headers)).json() == migrated.json()
            completed = await wait_for_chat_event(client, session_url, receipt['turn_id'], 'turn.completed')
            assert completed['payload']['text'] == '第一段第二段'
            assert received == ['独立的本轮输入']
            changed = await client.post(url, json={**body, 'content': '另一个输入'}, headers=headers)
            assert changed.status_code == 409, changed.text
            snapshot = (await client.get(session_url + '/snapshot')).json()['data']
            assert snapshot['session_id'] == 'sse-replay' and snapshot['kind'] == 'text'
            assert snapshot['cursor'] == completed['cursor']
            history = snapshot['history']['messages']
            older = await client.get(session_url + '/snapshot', params={'page': 2, 'page_size': 1})
            assert older.json()['data']['history']['messages'] == history[:1]
            assert older.json()['data']['cursor'] == snapshot['cursor']
            task_id = history[0]['payload']['interaction_run_id']
            late_stop = await client.post(f'/api/v1/studio/chat/sessions/text/sse-replay/turns/{task_id}/stop', json={})
            assert late_stop.json()['data']['status'] == 'succeeded'
            assert [(message['role'], message['content']) for message in history] == [
                ('user', '独立的本轮输入'), ('assistant', '第一段第二段'),
            ]
            concurrent = {'Idempotency-Key': 'concurrent-stream'}
            simultaneous = await asyncio.gather(*[client.post(
                url, json={**body, 'content': '并发请求只运行一次'}, headers=concurrent,
            ) for _ in range(2)])
            assert [item.status_code for item in simultaneous] == [202, 202]
            assert simultaneous[0].json() == simultaneous[1].json()
            await wait_for_chat_event(client, session_url, simultaneous[0].json()['data']['turn_id'], 'turn.completed')
            assert received.count('并发请求只运行一次') == 1
            stream_after_paging = await client.get(
                session_url + '/events', params={'after': snapshot['cursor'], 'follow': False})
            assert '独立的本轮输入' not in stream_after_paging.text
            assert '并发请求只运行一次' in stream_after_paging.text
            first_delta = asyncio.Event()
            release_followup = asyncio.Event()

            class InterruptedTextModel:
                async def stream(self, _messages):
                    yield ProviderChatEvent(kind='delta', text='已经送达的前缀')
                    first_delta.set()
                    await release_followup.wait()
                    yield ProviderChatEvent(kind='delta', text='快照后的后缀')
                    await asyncio.Future()

            monkeypatch.setattr(text_chat_streaming, 'build_laboratory_chat', AsyncMock(return_value=InterruptedTextModel()))
            interrupted = {'Idempotency-Key': 'interrupted-stream'}
            interrupted_body = {**body, 'content': '恢复未结束的流'}
            first = await client.post(url, json=interrupted_body, headers=interrupted)
            assert first.status_code == 202
            turn_id = first.json()['data']['turn_id']
            from app.services.studio import text_trials

            execution, = text_trials._executions
            try:
                await asyncio.wait_for(first_delta.wait(), timeout=5)
                delta = await wait_for_chat_event(client, session_url, turn_id, 'message.updated')
                active = (await client.get(session_url + '/snapshot')).json()['data']
                assert active['history']['active_turn_ids'] == [turn_id]
                assert active['cursor'] == delta['cursor']
                release_followup.set()
                appended = await wait_for_chat_event(client, session_url, turn_id, 'message.updated', after=active['cursor'])
                assert appended['payload']['text'] == '快照后的后缀'
                monkeypatch.setattr(text_chat_streaming, '_runtime', TextStreamingRuntime())
                checkpoint = (await client.get(session_url + '/snapshot')).json()['data']
                pending = next(item for item in checkpoint['history']['messages'] if item['content'] == interrupted_body['content'])
                assert not checkpoint['history'].get('active_turn_ids')
                assert pending['payload']['partial_text'] == '已经送达的前缀快照后的后缀'
                assert '_stream_partial' not in pending['payload']
                recovered = await client.post(url, json=interrupted_body, headers=interrupted)
                assert recovered.status_code == 202
                assert recovered.json() == first.json()
            finally:
                execution.cancel()
                await asyncio.gather(execution, return_exceptions=True)

    finally:
        await engine.dispose()
