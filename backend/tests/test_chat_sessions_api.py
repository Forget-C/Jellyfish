"""Unified chat transport contract over the production router."""
import json

import httpx
import pytest

from app.models.llm import ModelSettings, Provider
from tests.chat_events import wait_for_chat_event
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
async def test_canvas_snapshot_projects_history_at_its_committed_cursor(canvas_client, monkeypatch):
    import asyncio
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.models.canvas_assistant import CanvasAssistantSession

    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))

    provider_ready, release_provider = asyncio.Event(), asyncio.Event()
    snapshot_read, project_history = asyncio.Event(), asyncio.Event()
    send = httpx.AsyncClient.send
    read = AsyncSession.get
    reading = None

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await send(client, request, **kwargs)
        provider_ready.set()
        await release_provider.wait()
        return httpx.Response(200, request=request, json={'choices': [{
            'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': '竞态中的回复'},
        }]})

    async def read_session(session, entity, identity, **kwargs):
        result = await read(session, entity, identity, **kwargs)
        if entity is CanvasAssistantSession and asyncio.current_task() is reading and not snapshot_read.is_set():
            snapshot_read.set()
            await project_history.wait()
        return result

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    monkeypatch.setattr(AsyncSession, 'get', read_session)
    base = '/api/v1/studio'
    created = await canvas_client.post(base + '/generation-canvases', json={'name': '快照一致性'})
    url = f"{base}/chat/sessions/canvas/{created.json()['data']['id']}"
    receipt = await canvas_client.post(url + '/turns', json={'request_id': 'first', 'text': '你好'})
    assert receipt.status_code == 202, receipt.text
    await asyncio.wait_for(provider_ready.wait(), 5)
    reading = asyncio.create_task(canvas_client.get(url + '/snapshot'))
    try:
        await asyncio.wait_for(snapshot_read.wait(), 5)
        release_provider.set()
        completed = await wait_for_chat_event(canvas_client, url, 'first', 'turn.completed')
    finally:
        project_history.set()
        release_provider.set()

    snapshot = (await asyncio.wait_for(reading, 5)).json()['data']
    assert snapshot['history']['turns'][0]['reply'] == '竞态中的回复'
    assert snapshot['cursor'] == completed['cursor']
    assert not (await canvas_client.get(url + '/events',
        params={'after': snapshot['cursor'], 'follow': False})).text


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
@pytest.mark.parametrize(('kind', 'compatibility_kind', 'history_field'), [
    ('canvas', 'canvas', 'turns'),
    ('chat', 'lab', 'messages'),
    ('text', 'text', 'messages'),
    ('image', 'media', 'messages'),
    ('video', 'media', 'messages'),
])
async def test_public_snapshots_bind_each_session_kind(canvas_client, kind, compatibility_kind, history_field):
    base = '/api/v1/studio'
    if kind == 'canvas':
        created = await canvas_client.post(base + '/generation-canvases', json={'name': '统一交互会话'})
    else:
        created = await canvas_client.post(base + '/experiment-sessions', json={'lab_type': kind})
    assert created.is_success, created.text
    session_id = created.json()['data']['id']
    sessions = base + '/chat/sessions'
    bound = await canvas_client.get(f'{sessions}/{kind}/{session_id}/snapshot')
    assert bound.status_code == 200, bound.text
    snapshot = bound.json()['data']
    assert (snapshot['kind'], snapshot['session_id'], snapshot['cursor']) == (kind, session_id, 0)
    assert {'snapshot', 'send', 'events'}.issubset(snapshot['capabilities'])
    assert snapshot['history'][history_field] == []

    compatibility = await canvas_client.get(f'{sessions}/{compatibility_kind}/{session_id}')
    assert compatibility.status_code == 200, compatibility.text
    legacy = compatibility.json()
    if isinstance(legacy['data'], list):
        assert legacy['data'] == snapshot['history']['messages']
        assert legacy['meta']['cursor'] == snapshot['cursor']
    else:
        assert legacy['data'] == snapshot['history']

    other_kind = 'chat' if kind != 'chat' else 'text'
    wrong = f'{sessions}/{other_kind}/{session_id}'
    assert (await canvas_client.get(wrong + '/snapshot')).status_code == 404
    assert (await canvas_client.get(wrong + '/events', params={'follow': False})).status_code == 404
    assert (await canvas_client.post(wrong + '/turns', json={})).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
async def test_typed_lab_session_snapshot_bridges_admission_and_event_subscription(canvas_client, monkeypatch):
    import asyncio
    from app.models.llm import Model

    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        (await db.get(Model, 'canvas-text')).capability_profile = {
            'native_streaming': {'declaration': 'unsupported'},
        }
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))

    release = asyncio.Event()
    original = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        await release.wait()
        return httpx.Response(200, request=request, json={'choices': [{
            'index': 0, 'finish_reason': 'stop',
            'message': {'role': 'assistant', 'content': '正在恢复的聊天'},
        }]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    base = '/api/v1/studio'
    created = await canvas_client.post(base + '/experiment-sessions', json={'lab_type': 'chat'})
    sid = created.json()['data']['id']
    session_base = f'{base}/chat/sessions'
    url = f'{session_base}/chat/{sid}'
    wrong = f'{session_base}/text/{sid}'
    command = {'request_id': 'first', 'text': '你好'}
    assert (await canvas_client.get(wrong + '/snapshot')).status_code == 404
    assert (await canvas_client.get(wrong + '/events', params={'follow': False})).status_code == 404
    assert (await canvas_client.post(wrong + '/turns', json=command)).status_code == 404
    try:
        sent = await asyncio.wait_for(canvas_client.post(url + '/turns', json=command), 5)
        assert sent.status_code == 202, sent.text
        receipt = sent.json()['data']
        assert (receipt['session_id'], receipt['turn_id']) == (sid, 'first')
        response = await canvas_client.get(url + '/snapshot')
        assert response.status_code == 200, response.text
        snapshot = response.json()['data']
        assert (snapshot['kind'], snapshot['session_id']) == ('chat', sid)
        assert snapshot['cursor'] > receipt['cursor']
        assert snapshot['history']['active_turn'] == 'first'
        assert snapshot['history']['models']['text'] == 'canvas-text'
        assert snapshot['history']['messages'][0]['content'] == '你好'
    finally:
        release.set()

    await wait_for_chat_event(canvas_client, url, 'first', 'turn.completed')
    params = {'follow': False, 'after': snapshot['cursor']}
    stream = await canvas_client.get(url + '/events', params=params)
    compatibility_url = f'{session_base}/{sid}'
    assert (await canvas_client.post(compatibility_url + '/turns', json=command)).json() == sent.json()
    assert (await canvas_client.get(compatibility_url + '/events', params=params)).text == stream.text
    assert 'event: turn.accepted' not in stream.text
    assert 'event: turn.completed' in stream.text
    recovered = (await canvas_client.get(url + '/snapshot')).json()['data']
    assert recovered['history']['messages'][-1]['content'] == '正在恢复的聊天'
    assert recovered['history']['active_turn'] is None


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
    canvas_url = f"{base}/chat/sessions/canvas/{canvas['id']}"
    url = canvas_url
    snapshot = await canvas_client.get(url + '/snapshot')
    assert snapshot.status_code == 200
    assert snapshot.json()['data']['kind'] == 'canvas'
    assert snapshot.json()['data']['history']['turns'] == []
    command = {'request_id': 'test-turn', 'text': '请回答'}
    result = await canvas_client.post(url + '/turns', json=command)
    receipt = result.json()['data']
    assert (receipt['session_id'], receipt['turn_id']) == (canvas['id'], command['request_id'])
    assert set(receipt) == {'session_id', 'turn_id', 'cursor'}
    await wait_for_chat_event(canvas_client, url, command['request_id'], 'turn.completed')
    assert (await canvas_client.post(url + '/turns', json=command)).json()['data'] == result.json()['data']
    params = {'follow': False, 'after': receipt['cursor']}
    stream = await canvas_client.get(url + '/events', params=params)
    compatibility_url = f"{base}/chat/sessions/{canvas['id']}"
    assert (await canvas_client.post(compatibility_url + '/turns', json=command)).json() == result.json()
    assert (await canvas_client.get(compatibility_url + '/events', params=params)).text == stream.text
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

    stopped = await canvas_client.post(url + '/turns/test-turn/stop/snapshot')
    assert stopped.status_code == 200, stopped.text
    history = stopped.json()['data']
    assert history['cursor'] > events[-1]['cursor']
    assert history['pending_request'] is None
    assert history['turns'][0]['stopped'] is True
    assert (await canvas_client.get(url + '/snapshot')).json()['data']['history'] == history


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


def test_typed_and_legacy_chat_routes_share_public_receipt_and_event_contracts():
    from app.main import app

    paths = app.openapi()['paths']
    sessions = '/api/v1/studio/chat/sessions/'
    for scope in ('{session_id}', '{kind}/{session_id}'):
        stream = paths[sessions + scope + '/events']['get']['responses']['200']['content']['text/event-stream']
        assert stream['itemSchema']['properties']['data']['contentSchema'] == {'$ref': '#/components/schemas/ChatEvent'}
        responses = paths[sessions + scope + '/turns']['post']['responses']
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
        *(f'/labs/text/sessions/{sid}/{action}' for action in ('execute', 'tasks', 'stream')),
        *(f'/generation-tasks/labs/{mode}/sessions/{sid}/tasks' for mode in ('image', 'video')),
    ):
        result = await canvas_client.post(base + path, json={})
        assert result.status_code in (404, 405), path
    obsolete_lab_answer = await canvas_client.post(f'{base}/chat/sessions/lab/{sid}/turns/turn/answer', json={})
    assert obsolete_lab_answer.status_code == 422
    canvas = await canvas_client.post(base + '/generation-canvases', json={'name': '旧事件路由验证'})
    assert canvas.is_success
    canvas_id = canvas.json()['data']['id']
    events = await canvas_client.get(f'{base}/generation-canvases/{canvas_id}/assistant/events')
    assert events.status_code == 404
