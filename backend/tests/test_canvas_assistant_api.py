"""Canvas-scoped assistant conversations through the shared HTTP API."""
import asyncio

import json

import httpx
import pytest

from app.models.llm import Model, ModelSettings, Provider
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
        snapshot = (await canvas_client.get(url)).json()['data']
        assert snapshot['turns'] == []
        assert snapshot['cursor'] == 0
        assert snapshot['session_id'] == url.split('?')[0].split('/')[-2]
        assert snapshot['capabilities'] == ['snapshot', 'send', 'events', 'stop', 'approval']
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

    for url, replies in ((free_url, ['答复 自由一', '答复 自由二']), (scene_url, ['答复 分镜一'])):
        snapshot = (await canvas_client.get(url)).json()['data']
        events_url = append_canvas_path(url, '/events')
        events = (await canvas_client.get(events_url)).json()['data']
        assert [item['cursor'] for item in events] == list(range(1, len(replies) + 1))
        assert [item['payload']['reply'] for item in events] == replies
        assert all(item['session_id'] == snapshot['session_id'] and item['type'] == 'turn.completed'
                   and item['turn_id'] == item['payload']['request_id'] for item in events)
        assert snapshot['cursor'] == events[-1]['cursor']
        cursor_url = str(events_url) + ('&' if '?' in events_url else '?') + 'after='
        assert (await canvas_client.get(cursor_url + '1')).json()['data'] == events[1:]
        assert (await canvas_client.get(cursor_url + str(snapshot['cursor']))).json()['data'] == []


@pytest.mark.asyncio
@pytest.mark.parametrize('scene_owned', [False, True])
async def test_assistant_switches_model_without_losing_visible_card_scope(canvas_client, monkeypatch, scene_owned):
    requests = []
    real_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        body = json.loads(request.content)
        requests.append(body)
        messages = body['messages']
        tool_result = next((item for item in messages if item['role'] == 'tool'), None)
        answer = {'role': 'assistant', 'content': '已分析'}
        reason = 'stop'
        if tool_result is None:
            assert {tool['function']['name'] for tool in body['tools']} == {
                'read_canvas_context', 'load_canvas_skill', 'read_canvas_skill_example', 'propose_canvas_structure',
            }
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': 'call-context', 'type': 'function',
                'function': {'name': 'read_canvas_context', 'arguments': '{}'},
            }]}
            reason = 'tool_calls'
        else:
            context = json.loads(tool_result['content'])
            expected = ['target'] if len(requests) <= 2 else ['target', 'basis', 'unrelated']
            assert context['target_card_ids'] == expected
            assert [card['id'] for card in context['cards']] == list(dict.fromkeys([*expected, 'basis']))
            assert context['cards'][0]['prompt']['segments'][0]['text'] == '只在编辑器可见'
        return httpx.Response(200, request=request, json={
            'id': 'result', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': reason, 'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
        db.add(Model(id='tool-model', name='tool-model', category='text', provider_id=provider.id,
                     capability_profile={'tool_calling': {'declaration': 'supported'}}))

    if scene_owned:
        canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '分镜画布'})).json()['data']
        url = canvas_url(f"/canvases/p/{canvas['id']}")
    else:
        canvas = (await canvas_client.post('/canvases', json={'name': '自由画布'})).json()['data']
        url = f"/canvases/{canvas['id']}"
    assistant = append_canvas_path(url, '/assistant')
    draft = dict(canvas['document'], cards=[
        {'id': 'target', 'type': 'model.video', 'model_id': 'original-generator',
         'prompt': {'segments': [{'id': 'text', 'kind': 'text', 'text': '只在编辑器可见'}]},
         'input_bindings': [{'id': 'basis', 'source': {'canvas_id': canvas['id'], 'card_id': 'basis',
                                                      'port_id': 'text', 'position': 0}, 'input_port': 'text'}]},
        {'id': 'basis', 'type': 'content.text', 'text': '实际采用'},
        {'id': 'unrelated', 'type': 'model.video', 'prompt': {'segments': [
            {'id': 'text', 'kind': 'text', 'text': '另一个同名模型卡'},
        ]}},
    ])
    turn = {'request_id': 'scope-id', 'text': '看这两张卡', 'context': {
        'draft': draft, 'revision': canvas['revision'], 'scope': 'selection', 'card_ids': ['target'],
    }}
    blocked = await canvas_client.post(assistant, json=turn)
    assert blocked.status_code == 422, blocked.text
    assert blocked.json()['detail'] == 'ASSISTANT_TOOL_CALLING_REQUIRED'
    assert requests == []
    chosen = await canvas_client.patch(append_canvas_path(url, '/assistant/model'), json={'model_id': 'tool-model'})
    assert chosen.status_code == 200, chosen.text
    result = await canvas_client.post(assistant, json=turn)
    assert result.status_code == 200, result.text
    assert [request['model'] for request in requests] == ['tool-model', 'tool-model']
    assert (await canvas_client.post(assistant, json=turn)).json() == result.json()
    assert len(requests) == 2
    history = (await canvas_client.get(assistant)).json()['data']
    assert history['model_id'] == 'tool-model'
    assert history['turns'][0]['context']['target_card_ids'] == ['target']
    assert history['turns'][0]['context']['cards'][0]['model_id'] == 'original-generator'
    whole_canvas = dict(turn, request_id='whole-id', context=dict(turn['context'], scope='canvas'))
    assert (await canvas_client.post(assistant, json=whole_canvas)).status_code == 200
    assert (await canvas_client.get(url)).json()['data']['document'] == canvas['document']
    assert (await canvas_client.get(append_canvas_path(url, '/runtime'))).json()['data']['runs'] == []


@pytest.mark.asyncio
async def test_can_stop_request_before_first_assistant_reply(canvas_client, monkeypatch):
    replying, proceed = asyncio.Event(), asyncio.Event()
    real_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        replying.set()
        await proceed.wait()
        return httpx.Response(200, request=request, json={
            'id': 'result', 'object': 'chat.completion', 'created': 1, 'model': 'canvas-text',
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': '过期回复'}}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))

    canvas = (await canvas_client.post('/canvases', json={'name': '自由画布'})).json()['data']
    assistant = f"/canvases/{canvas['id']}/assistant"
    message = {'request_id': 'running-turn', 'text': '正在回复时停止'}
    reply = asyncio.create_task(canvas_client.post(assistant, json=message))
    try:
        await asyncio.wait_for(replying.wait(), 5)
        stopped = await canvas_client.post(assistant + '/turns/running-turn/stop')
        assert stopped.status_code == 200, stopped.text
        assert stopped.json()['data']['stopped']
    finally:
        proceed.set()
        await reply
    history = (await canvas_client.get(assistant)).json()['data']
    assert len(history['turns']) == 1
    assert history['turns'][0]['stopped'] and not history['turns'][0]['reply']
    assert (await canvas_client.post(assistant, json=message)).json()['data'] == history['turns'][0]


@pytest.mark.asyncio
async def test_resending_interrupted_assistant_turn_continues_completed_tool_step(canvas_client, monkeypatch):
    calls = []
    real_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        body = json.loads(request.content)
        called_tool = any(item['role'] == 'tool' for item in body['messages'])
        calls.append(called_tool)
        if not called_tool:
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': 'read-context', 'type': 'function',
                'function': {'name': 'read_canvas_context', 'arguments': '{}'},
            }]}
        elif len(calls) == 2:
            raise RuntimeError('disconnected after completed tool step')
        else:
            answer = {'role': 'assistant', 'content': '已从中断处继续'}
        return httpx.Response(200, request=request, json={
            'id': 'result', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'stop' if called_tool else 'tool_calls', 'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}}
        model.params = {**model.params, 'max_retries': 0}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))

    canvas = (await canvas_client.post('/canvases', json={'name': '自由画布'})).json()['data']
    assistant = f"/canvases/{canvas['id']}/assistant"
    command = {'request_id': 'resume-turn', 'text': '分析画布', 'context': {
        'draft': canvas['document'], 'revision': canvas['revision'], 'scope': 'canvas',
    }}
    assert (await canvas_client.post(assistant, json=command)).status_code == 502
    history = (await canvas_client.get(assistant)).json()['data']
    assert history['turns'] == []
    assert history['pending_request']['request_id'] == command['request_id']
    assert history['pending_request']['context']['draft'] == command['context']['draft']
    assert (await canvas_client.post(assistant, json=history['pending_request'])).json()['data']['reply'] == '已从中断处继续'
    assert (await canvas_client.get(assistant)).json()['data']['pending_request'] is None
    assert calls == [False, True, True]


@pytest.mark.asyncio
async def test_assistant_model_context_limit_keeps_current_request_and_drops_old_exchange(canvas_client, monkeypatch):
    prompts = []
    real_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        body = json.loads(request.content)
        prompts.append([item['content'] for item in body['messages'] if item['role'] == 'user'])
        return httpx.Response(200, request=request, json={
            'id': 'result', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': '答复'}}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    canvas = (await canvas_client.post('/canvases', json={'name': '自由画布'})).json()['data']
    assistant = f"/canvases/{canvas['id']}/assistant"
    long_text = '长旧消息' * 3500
    assert (await canvas_client.post(assistant, json={'request_id': 'long', 'text': long_text})).status_code == 200
    async with canvas_client.canvas_sessions.begin() as db:
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'max_input_tokens': 4096}

    response = await canvas_client.post(assistant, json={'request_id': 'short', 'text': '新问题'})
    assert response.status_code == 200, response.text
    assert prompts[-1] == ['新问题']
    too_large = await canvas_client.post(assistant, json={'request_id': 'long2', 'text': long_text})
    assert too_large.status_code == 422 and too_large.json()['detail'] == 'ASSISTANT_CONTEXT_LIMIT_EXCEEDED'
    assert prompts == [[long_text], ['新问题']]
    history = (await canvas_client.get(assistant)).json()['data']
    assert len(history['turns']) == 2
    async with canvas_client.canvas_sessions.begin() as db:
        db.add(Model(id='large-window', name='large-window', category='text', provider_id='canvas-provider'))
    assert (await canvas_client.patch(assistant + '/model', json={'model_id': 'large-window'})).status_code == 200
    retried = (await canvas_client.post(assistant, json=history['pending_request'])).json()['data']
    assert retried['request_id'] == 'long2' and retried['model_id'] == 'large-window'
