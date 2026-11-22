"""Canvas-scoped assistant conversations through the shared HTTP API."""
import json

import httpx
import pytest

from app.models.llm import ModelSettings, Provider
from tests.canvas_urls import append_canvas_path, canvas_url, seed_scene_canvas
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
async def test_assistant_reopens_isolated_canvas_history_and_replays_turn(canvas_client, monkeypatch):
    prompts = []

    real_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        options = json.loads(request.content)
        model = options['model']
        assert model == 'canvas-text'
        assert not options.get('tools')
        prompt = [message['content'] for message in options['messages'] if message['role'] == 'user']
        prompts.append(prompt)
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': model,
            'choices': [{'index': 0, 'finish_reason': 'stop',
                         'message': {'role': 'assistant', 'content': f'答复 {prompt[-1]}'}}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))

    free = (await canvas_client.post('/canvases', json={'name': '自由画布'})).json()['data']
    scene = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '分镜画布'})).json()['data']
    free_url = f"/canvases/{free['id']}/assistant"
    scene_url = append_canvas_path(canvas_url(f"/canvases/p/{scene['id']}"), '/assistant')
    assert (await canvas_client.get(f"/canvases/{scene['id']}/assistant")).status_code == 404
    for url in (free_url, scene_url):
        assert (await canvas_client.get(url)).json()['data']['turns'] == []
    assert prompts == []

    async def send(url, request_id, text):
        return await canvas_client.post(url, json={'request_id': request_id, 'text': text})

    original = (await send(free_url, 'same-id', '自由一')).json()['data']
    assert original['reply'] == '答复 自由一'
    assert original['model_id'] == 'canvas-text'
    assert (await send(scene_url, 'same-id', '分镜一')).json()['data']['reply'] == '答复 分镜一'
    assert (await send(free_url, 'same-id', '自由一')).json()['data'] == original
    assert (await send(free_url, 'same-id', '不同正文')).status_code == 409
    assert (await send(free_url, 'follow-up', '自由二')).json()['data']['reply'] == '答复 自由二'
    assert prompts == [['自由一'], ['分镜一'], ['自由一', '自由二']]
    turns = (await canvas_client.get(free_url)).json()['data']['turns']
    assert [(item['sequence'], item['text'], item['reply']) for item in turns] == [
        (1, '自由一', '答复 自由一'), (2, '自由二', '答复 自由二'),
    ]
    turns = (await canvas_client.get(scene_url)).json()['data']['turns']
    assert [item['reply'] for item in turns] == ['答复 分镜一']
