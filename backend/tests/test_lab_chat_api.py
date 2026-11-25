"""Drive multimodal conversations through the public API with a controlled provider."""
import json

import httpx
import pytest

from app.models.llm import Model, ModelSettings, Provider
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
async def test_lab_chat_replays_messages_and_uses_previous_turn(canvas_client, monkeypatch):
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        (await db.get(Model, 'canvas-text')).capability_profile = {
            'native_streaming': {'declaration': 'unsupported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    original = httpx.AsyncClient.send
    prompts = []

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        assert not body.get('stream')
        prompts.append(body['messages'])
        return httpx.Response(200, request=request, json={
            'id': 'msg', 'choices': [{'index': 0, 'finish_reason': 'stop',
                                      'message': {'role': 'assistant', 'content': '霓虹'}}]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    created = await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})
    assert created.status_code == 201, created.text
    url = '/api/v1/studio/chat/sessions/lab/' + created.json()['data']['id']
    for request_id, prompt in [('first', '雨夜'), ('next', '接着说')]:
        body = {'request_id': request_id, 'text': prompt}
        sent = await canvas_client.post(url + '/turns', json=body)
        assert sent.status_code == 200, sent.text
        repeat = await canvas_client.post(url + '/turns', json=body)
        assert repeat.status_code == 200
    assert len(prompts) == 2 and any(m['content'] == '雨夜' for m in prompts[1])
    snapshot = (await canvas_client.get(url)).json()['data']
    assert not snapshot['active_turn'] and snapshot['models']['text'] == 'canvas-text'
    assert [m['content'] for m in snapshot['messages']] == ['雨夜', '霓虹', '接着说', '霓虹']
    events = await canvas_client.get(url + '/events', params={'follow': False})
    assert 'event: turn.completed' in events.text


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
async def test_chat_admission_stop_and_independent_session(canvas_client, monkeypatch):
    import asyncio
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        (await db.get(Model, 'canvas-text')).capability_profile = {
            'native_streaming': {'declaration': 'unsupported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    entered, resume = asyncio.Event(), asyncio.Event()
    original = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        if 'pause' in request.content.decode():
            entered.set()
            await resume.wait()
        return httpx.Response(200, request=request, json={'choices': [{'index': 0, 'finish_reason': 'stop',
                          'message': {'role': 'assistant', 'content': 'reply'}}]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async def create():
        result = await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})
        return '/api/v1/studio/chat/sessions/lab/' + result.json()['data']['id']

    first, second = await create(), await create()
    command = {'request_id': 'one', 'text': 'pause'}
    active = asyncio.create_task(canvas_client.post(first + '/turns', json=command))
    try:
        await asyncio.wait_for(entered.wait(), 8)
        assert (await canvas_client.get(first)).json()['data']['active_turn'] == 'one'
        assert (await canvas_client.post(first + '/turns', json=command)).status_code == 200
        another = {'request_id': 'two', 'text': 'new'}
        assert (await canvas_client.post(first + '/turns', json=another)).status_code == 409
        assert (await canvas_client.post(second + '/turns', json=another)).status_code == 200
        stopped = await canvas_client.post(first + '/turns/one/stop')
        assert stopped.json()['data']['active_turn'] is None
    finally:
        resume.set()
        await active
    snapshot = (await canvas_client.get(first)).json()['data']
    assert [m['status'] for m in snapshot['messages'] if m['role'] == 'assistant'] == ['stopped']


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
async def test_media_understanding_is_checked_before_turn_admission(canvas_client):
    async with canvas_client.canvas_sessions.begin() as db:
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'image_inputs': {'declaration': 'unsupported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    file = await canvas_client.post('/api/v1/studio/files/upload', files={'file': ('scene.png', b'picture', 'image/png')})
    created = await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})
    url = '/api/v1/studio/chat/sessions/lab/' + created.json()['data']['id']
    prefs = await canvas_client.patch(url + '/models', json={'image': 'canvas-image', 'video': 'canvas-video'})
    assert prefs.json()['data'] == {'text': 'canvas-text', 'image': 'canvas-image', 'video': 'canvas-video'}
    response = await canvas_client.post(url + '/turns', json={
        'request_id': 'analyze', 'text': '分析图片', 'file_ids': [file.json()['data']['id']]})
    assert response.status_code == 422 and 'ASSISTANT_MODEL_INPUT_UNSUPPORTED' in response.text
    snapshot = (await canvas_client.get(url)).json()['data']
    assert not snapshot['active_turn'] and not snapshot['messages'] and snapshot['models'] == prefs.json()['data']


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
async def test_native_text_stream_publishes_real_model_chunks(canvas_client, monkeypatch):
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'native_streaming': {'declaration': 'supported'}}
        db.add(ModelSettings(id=1, default_text_model_id=model.id))
    original = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        assert json.loads(request.content)['stream']
        chunks = [{'choices': [{'index': 0, 'delta': {'content': part}}]} for part in ('rain', 'fall')]
        return httpx.Response(200, request=request, headers={'content-type': 'text/event-stream'},
                              content=''.join('data: ' + json.dumps(chunk) + '\n\n' for chunk in chunks)
                              + 'data: [DONE]\n\n')

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    created = await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})
    url = '/api/v1/studio/chat/sessions/lab/' + created.json()['data']['id']
    reply = await canvas_client.post(url + '/turns', json={'text': 'weather', 'request_id': 'stream'})
    assert reply.status_code == 200, reply.text
    assert reply.json()['data']['messages'][-1]['content'] == 'rainfall'
    stream = await canvas_client.get(url + '/events', params={'follow': 'false'})
    events = [json.loads(line[6:]) for line in stream.text.splitlines() if line.startswith('data: ')]
    assert [e['payload']['text'] for e in events if e['type'] == 'message.updated'] == ['rain', 'rainfall']
