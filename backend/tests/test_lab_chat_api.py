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
