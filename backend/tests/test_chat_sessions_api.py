"""Unified chat transport contract over the production router."""
import json

import httpx
import pytest

from app.models.llm import ModelSettings, Provider
from tests.chat_events import wait_for_chat_event
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
async def test_session_events_can_open_with_one_database_connection(canvas_client, monkeypatch):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.dependencies import get_db
    from app.main import app

    created = await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})
    session_id = created.json()['data']['id']
    engine = create_async_engine(canvas_client.canvas_sessions.kw['bind'].url,
                                 pool_size=1, max_overflow=0, pool_timeout=1)
    sessions = async_sessionmaker(engine)

    async def database():
        async with sessions() as db:
            yield db

    try:
        with monkeypatch.context() as patch:
            patch.setitem(app.dependency_overrides, get_db, database)
            response = await canvas_client.get(f'/api/v1/studio/chat/sessions/{session_id}/events',
                                               params={'follow': False})
        assert response.status_code == 200 and response.text == ''
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
async def test_canvas_turn_can_be_replayed_through_session_events(canvas_client, monkeypatch):
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    calls = []
    send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await send(client, request, **kwargs)
        calls.append(request)
        return httpx.Response(200, request=request, json={
            'id': 'chat', 'choices': [{'index': 0, 'finish_reason': 'stop',
                                      'message': {'role': 'assistant', 'content': '雨夜街景'}}]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    base = '/api/v1/studio'
    canvas = (await canvas_client.post(base + '/generation-canvases', json={'name': '新画布'})).json()['data']
    url = f"{base}/chat/sessions/{canvas['id']}"
    canvas_url = f"{base}/chat/sessions/canvas/{canvas['id']}"
    snapshot = await canvas_client.get(canvas_url)
    assert snapshot.status_code == 200
    assert snapshot.json()['data']['turns'] == []
    command = {'request_id': 'test-turn', 'text': '请回答'}
    result = await canvas_client.post(url + '/turns', json=command)
    receipt = result.json()['data']
    assert (receipt['session_id'], receipt['turn_id']) == (canvas['id'], command['request_id'])
    assert set(receipt) == {'session_id', 'turn_id', 'cursor'}
    await wait_for_chat_event(canvas_client, url, command['request_id'], 'turn.completed')
    assert (await canvas_client.post(url + '/turns', json=command)).json()['data'] == result.json()['data']
    stream = await canvas_client.get(url + '/events', params={'follow': 'false', 'after': receipt['cursor']})
    assert stream.headers['content-type'].startswith('text/event-stream')
    events = [json.loads(line[6:]) for line in stream.text.splitlines() if line.startswith('data: ')]
    assert events[0]['type'] == 'turn.accepted'
    assert events[0]['category'] == 'turn' and events[-1]['detail']['reply'] == '雨夜街景'
    assert events[-1]['type'] == 'turn.completed'
    assert events[-1]['payload'] == {'text': '雨夜街景', 'error': None, 'reason': None}
    assert all(event['turn_id'] == 'test-turn' for event in events)
    assert len(calls) == 1
    replay = await canvas_client.get(url + '/events', params={'follow': 'false'}, headers={'Last-Event-ID': str(events[-2]['cursor'])})
    assert [json.loads(line[6:]) for line in replay.text.splitlines() if line.startswith('data: ')] == events[-1:]


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
async def test_read_card_tool_is_identified_before_reply(canvas_client, monkeypatch):
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        from app.models.llm import Model
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported'},
                                    'native_streaming': {'declaration': 'unsupported'}}
        db.add(ModelSettings(id=1, default_text_model_id=model.id))
    send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await send(client, request, **kwargs)
        payload = json.loads(request.content)
        assert not payload.get('stream')
        result = next((item for item in payload['messages'] if item['role'] == 'tool'), None)
        if result:
            assert result['tool_call_id'] == 'read-note'
            assert '实际卡片文字' in result['content']
            message = {'role': 'assistant', 'content': '已读取实际卡片文字'}
        else:
            message = {'role': 'assistant', 'tool_calls': [{'id': 'read-note', 'type': 'function',
                       'function': {'name': 'read_canvas', 'arguments': '{}'}}]}
        return httpx.Response(200, request=request, json={'id': 'model-reply', 'choices': [{
            'index': 0, 'finish_reason': 'stop' if result else 'tool_calls', 'message': message}]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    base = '/api/v1/studio'
    canvas = (await canvas_client.post(base + '/generation-canvases', json={'name': '画布'})).json()['data']
    url = f"{base}/chat/sessions/{canvas['id']}"
    canvas_url = f"{base}/chat/sessions/canvas/{canvas['id']}"
    draft = dict(canvas['document'], cards=[{'id': 'note', 'type': 'content.text', 'text': '实际卡片文字'}])
    body = {'request_id': 'read-card', 'text': '读一下这张卡', 'stream_reply': True,
            'context': {'draft': draft, 'revision': canvas['revision'], 'scope': 'selection', 'card_ids': ['note']}}
    response = await canvas_client.post(url + '/turns', json=body)
    assert response.status_code == 202, response.text
    await wait_for_chat_event(canvas_client, url, body['request_id'], 'turn.completed')
    stream = await canvas_client.get(url + '/events', params={'follow': 'false'})
    events = [json.loads(line[6:]) for line in stream.text.splitlines() if line.startswith('data: ')]
    tool_events = [e for e in events if e['type'].startswith('tool.')]
    assert [(e['type'], e['payload']['tool_call_id']) for e in tool_events] == [
        ('tool.started', 'read-note'), ('tool.completed', 'read-note')]
    assert tool_events[-1]['cursor'] < events[-1]['cursor']
    snapshot = (await canvas_client.get(canvas_url)).json()['data']
    tool, = snapshot['turns'][0]['tool_calls']
    assert (tool['id'], tool['name'], tool['state']) == ('read-note', 'read_canvas', 'completed')
    assert snapshot['turns'][0]['model_id'] == 'canvas-text'


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
async def test_first_save_uses_the_same_chat_session(canvas_client, monkeypatch):
    from uuid import uuid4

    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    original = httpx.AsyncClient.send

    async def reply(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        return httpx.Response(200, request=request, json={'choices': [{'index': 0, 'finish_reason': 'stop',
                             'message': {'role': 'assistant', 'content': 'saved canvas reply'}}]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', reply)
    canvas_id = str(uuid4())
    base = '/api/v1/studio'
    url = f'{base}/chat/sessions/{canvas_id}'
    draft_url = f'{base}/generation-canvases/drafts/{canvas_id}'
    command = {'request_id': 'first-turn', 'text': 'hello'}
    assert (await canvas_client.post(url + '/turns', json=command)).status_code == 404
    document = (await canvas_client.get(draft_url)).json()['data']['document']
    saved = await canvas_client.put(draft_url, json={
        'request_id': 'save', 'expected_revision': 0, 'document': document, 'start_assistant': True,
    })
    assert saved.is_success, saved.text
    accepted = await canvas_client.post(url + '/turns', json=command)
    assert accepted.status_code == 202, accepted.text
    event = await wait_for_chat_event(canvas_client, url, 'first-turn', 'turn.completed')
    assert event['payload']['text'] == 'saved canvas reply'
    history = await canvas_client.get(f'{base}/chat/sessions/canvas/{canvas_id}')
    assert history.json()['data']['turns'][0]['request_id'] == 'first-turn'


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
async def test_session_type_controls_dispatch_even_for_a_valid_foreign_command(canvas_client):
    base = '/api/v1/studio'
    created = await canvas_client.post(base + '/experiment-sessions', json={'lab_type': 'image'})
    session_id = created.json()['data']['id']
    url = f'{base}/chat/sessions/{session_id}'
    rejected = await canvas_client.post(url + '/turns', json={
        'execution_prompt': 'test', 'operation_input': {'kind': 'video_generation', 'seconds': 5, 'ratio': '16:9'},
    })
    assert rejected.status_code == 422
    assert rejected.json()['message'] == 'operation_input_invalid'
    stream = await canvas_client.get(url + '/events?follow=false')
    assert stream.status_code == 200 and not stream.text


def test_chat_api_exposes_only_one_send_and_event_subscription():
    from app.main import app

    paths = app.openapi()['paths']
    sessions = '/api/v1/studio/chat/sessions/'
    assert {p for p, ops in paths.items() if p.startswith(sessions) and p.endswith('/turns') and 'post' in ops} == {
        sessions + '{session_id}/turns'}
    assert {p for p in paths if p.startswith(sessions) and p.endswith('/events')} == {sessions + '{session_id}/events'}
    stream = paths[sessions + '{session_id}/events']['get']['responses']['200']['content']['text/event-stream']
    assert stream['itemSchema']['properties']['data']['contentSchema'] == {'$ref': '#/components/schemas/ChatEvent'}
    responses = paths[sessions + '{session_id}/turns']['post']['responses']
    assert responses['202']['content']['application/json']['schema']['$ref'].endswith('/ApiResponse_ChatTurnReceipt_')


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
async def test_retired_chat_routes_cannot_execute_or_subscribe(canvas_client):
    base = '/api/v1/studio'
    sid = 'a00e6fca-316f-4625-80c7-e2824ff2137d'
    for path in (
        f'/generation-canvases/drafts/{sid}/assistant',
        f'/generation-canvases/{sid}/assistant',
        f'/generation-canvases/{sid}/assistant/turns/turn/answer',
        f'/chat/sessions/canvas/{sid}/turns/turn/answer',
        f'/chat/sessions/lab/{sid}/turns/turn/answer',
        *(f'/labs/text/sessions/{sid}/{action}' for action in ('execute', 'tasks', 'stream')),
        *(f'/generation-tasks/labs/{mode}/sessions/{sid}/tasks' for mode in ('image', 'video')),
    ):
        result = await canvas_client.post(base + path, json={})
        assert result.status_code in (404, 405), path
    canvas = await canvas_client.post(base + '/generation-canvases', json={'name': '旧事件路由验证'})
    assert canvas.is_success
    canvas_id = canvas.json()['data']['id']
    events = await canvas_client.get(f'{base}/generation-canvases/{canvas_id}/assistant/events')
    assert events.status_code == 404
