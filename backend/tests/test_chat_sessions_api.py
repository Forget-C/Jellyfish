"""Unified chat transport contract over the production router."""
import json

import httpx
import pytest

from app.models.llm import ModelSettings, Provider
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
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
    url = f"{base}/chat/sessions/canvas/{canvas['id']}"
    snapshot = await canvas_client.get(url)
    assert snapshot.status_code == 200
    assert snapshot.json()['data']['turns'] == []
    command = {'request_id': 'test-turn', 'text': '请回答'}
    result = await canvas_client.post(url + '/turns', json=command)
    assert result.json()['data']['reply'] == '雨夜街景'
    assert (await canvas_client.post(url + '/turns', json=command)).json()['data'] == result.json()['data']
    stream = await canvas_client.get(url + '/events', params={'follow': 'false'})
    assert stream.headers['content-type'].startswith('text/event-stream')
    events = [json.loads(line[6:]) for line in stream.text.splitlines() if line.startswith('data: ')]
    assert events[0]['type'] == 'turn.accepted'
    assert events[-1]['type'] == 'turn.completed'
    assert all(event['turn_id'] == 'test-turn' for event in events)
    assert len(calls) == 1
    replay = await canvas_client.get(url + '/events', params={'follow': 'false'}, headers={'Last-Event-ID': str(events[-2]['cursor'])})
    assert [json.loads(line[6:]) for line in replay.text.splitlines() if line.startswith('data: ')] == events[-1:]


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
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
    url = f"{base}/chat/sessions/canvas/{canvas['id']}"
    draft = dict(canvas['document'], cards=[{'id': 'note', 'type': 'content.text', 'text': '实际卡片文字'}])
    body = {'request_id': 'read-card', 'text': '读一下这张卡', 'stream_reply': True,
            'context': {'draft': draft, 'revision': canvas['revision'], 'scope': 'selection', 'card_ids': ['note']}}
    response = await canvas_client.post(url + '/turns', json=body)
    assert response.status_code == 200, response.text
    stream = await canvas_client.get(url + '/events', params={'follow': 'false'})
    events = [json.loads(line[6:]) for line in stream.text.splitlines() if line.startswith('data: ')]
    tool_events = [e for e in events if e['type'].startswith('tool.')]
    assert [(e['type'], e['payload']['progress']['tool_call']['id']) for e in tool_events] == [
        ('tool.started', 'read-note'), ('tool.completed', 'read-note')]
    assert tool_events[-1]['cursor'] < events[-1]['cursor']
    snapshot = (await canvas_client.get(url)).json()['data']
    tool, = snapshot['turns'][0]['tool_calls']
    assert (tool['id'], tool['name'], tool['state']) == ('read-note', 'read_canvas', 'completed')
    assert snapshot['turns'][0]['model_id'] == 'canvas-text'
