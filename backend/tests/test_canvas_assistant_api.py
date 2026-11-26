"""Canvas-scoped assistant conversations through the shared HTTP API."""
import asyncio

import json

import httpx
import pytest

from app.models.llm import Model, ModelSettings, Provider
from tests.canvas_urls import append_canvas_path, canvas_url, seed_scene_canvas
from tests.chat_events import canvas_chat_url, observe_canvas_turn, read_canvas_chat_snapshot, read_canvas_events, wait_for_chat_event
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
    assert (await read_canvas_chat_snapshot(canvas_client, f"/canvases/{scene['id']}/assistant")).status_code == 404
    for url in (free_url, scene_url):
        snapshot = (await read_canvas_chat_snapshot(canvas_client, url)).json()['data']
        assert snapshot['turns'] == []
        assert snapshot['cursor'] == 0
        assert snapshot['session_id'] == url.split('?')[0].split('/')[-2]
        assert snapshot['capabilities'] == ['snapshot', 'send', 'events', 'stop', 'approval', 'question']
    assert prompts == []

    async def send(url, request_id, text):
        return await observe_canvas_turn(canvas_client, url, json={'request_id': request_id, 'text': text})

    original = (await send(free_url, 'same-id', '自由一')).detail
    assert original['reply'] == '答复 自由一'
    assert original['model_id'] == 'canvas-text'
    assert (await send(scene_url, 'same-id', '分镜一')).detail['reply'] == '答复 分镜一'
    assert (await send(free_url, 'same-id', '自由一')).detail == original
    assert (await send(free_url, 'same-id', '不同正文')).receipt.status_code == 409
    assert (await send(free_url, 'follow-up', '自由二')).detail['reply'] == '答复 自由二'
    assert prompts == [['自由一'], ['分镜一'], ['自由一', '自由二']]
    turns = (await read_canvas_chat_snapshot(canvas_client, free_url)).json()['data']['turns']
    assert [(item['sequence'], item['text'], item['reply']) for item in turns] == [
        (1, '自由一', '答复 自由一'), (2, '自由二', '答复 自由二'),
    ]
    turns = (await read_canvas_chat_snapshot(canvas_client, scene_url)).json()['data']['turns']
    assert [item['reply'] for item in turns] == ['答复 分镜一']

    for url, replies in ((free_url, ['答复 自由一', '答复 自由二']), (scene_url, ['答复 分镜一'])):
        snapshot = (await read_canvas_chat_snapshot(canvas_client, url)).json()['data']
        events = await read_canvas_events(canvas_client, url)
        assert [item['cursor'] for item in events] == list(range(1, len(events) + 1))
        assert [item['payload']['text'] for item in events if item['type'] == 'turn.completed'] == replies
        assert all(item['session_id'] == snapshot['session_id'] and item['turn_id'] == item['detail']['request_id']
                   for item in events)
        assert [item['type'] for item in events if item['category'] == 'turn'] == [
            kind for _ in replies for kind in ('turn.accepted', 'turn.completed')
        ]
        assert snapshot['cursor'] == events[-1]['cursor']
        assert await read_canvas_events(canvas_client, url, after=1) == events[1:]
        assert await read_canvas_events(canvas_client, url, after=snapshot['cursor']) == []


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
        if body['model'] == 'canvas-text':
            assert not body.get('tools')
            supplied = next(item['content'] for item in reversed(messages) if item['role'] == 'user')
            if '分析 camera-note' not in supplied:
                assert '只在编辑器可见' in supplied and '实际采用' in supplied
                assert '另一个同名模型卡' not in supplied
            assert '当前画布支持的卡片' in supplied
            assert ('direction.movement（' in supplied) == scene_owned
        elif messages[-1].get('content') == '检查第二页':
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': 'read-second-page', 'type': 'function',
                'function': {'name': 'read_canvas', 'arguments': '{"offset":1,"limit":2}'},
            }]}
            reason = 'tool_calls'
        elif tool_result and tool_result.get('tool_call_id') == 'read-second-page':
            page = json.loads(tool_result['content'])
            assert [card['id'] for card in page['cards']] == ['basis', 'filler-00']
            assert page['next_offset'] == 3
        elif tool_result is None:
            assert {tool['function']['name'] for tool in body['tools']} == {
                'read_canvas', 'load_canvas_skill', 'read_canvas_skill_example', 'preview_canvas_structure',
                'preview_canvas_changes', 'inspect_canvas_inputs', 'read_canvas_approval',
                'ask_canvas_question', 'delegate_canvas_tasks',
            }
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': 'call-context', 'type': 'function',
                'function': {'name': 'read_canvas', 'arguments': '{}'},
            }]}
            reason = 'tool_calls'
        else:
            context = json.loads(tool_result['content'])
            expected = ['target'] if len(requests) <= 3 else ['target', 'basis', 'unrelated']
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
    reviewed = await observe_canvas_turn(canvas_client, assistant, json={**turn, 'request_id': 'text-scope'})
    assert reviewed.receipt.status_code == 202, reviewed.receipt.text
    assert reviewed.detail['reply'] == '已分析'
    assert reviewed.detail['context']['target_card_ids'] == ['target']
    assert reviewed.detail['proposal'] is None
    chosen = await canvas_client.patch(append_canvas_path(url, '/assistant/model'), json={'model_id': 'tool-model'})
    assert chosen.status_code == 200, chosen.text
    result = await observe_canvas_turn(canvas_client, assistant, json=turn)
    assert result.receipt.status_code == 202, result.receipt.text
    assert [request['model'] for request in requests] == ['canvas-text', 'tool-model', 'tool-model']
    assert (await observe_canvas_turn(canvas_client, assistant, json=turn)).detail == result.detail
    assert len(requests) == 3
    history = (await read_canvas_chat_snapshot(canvas_client, assistant)).json()['data']
    assert history['model_id'] == 'tool-model'
    assert history['turns'][0]['context']['target_card_ids'] == ['target']
    assert history['turns'][0]['context']['cards'][0]['model_id'] == 'original-generator'
    whole_canvas = dict(turn, request_id='whole-id', context=dict(turn['context'], scope='canvas'))
    assert (await observe_canvas_turn(canvas_client, assistant, json=whole_canvas)).receipt.status_code == 202
    assert (await canvas_client.get(url)).json()['data']['document'] == canvas['document']
    assert (await canvas_client.get(append_canvas_path(url, '/runtime'))).json()['data']['runs'] == []

    # A bounded read must still include the named card, even at the end of the canvas.
    chosen = await canvas_client.patch(append_canvas_path(url, '/assistant/model'), json={'model_id': 'canvas-text'})
    assert chosen.status_code == 200, chosen.text
    large = dict(draft, cards=[
        *draft['cards'][:2],
        *[{'id': f'filler-{index:02}', 'type': 'content.text', 'text': '其他草稿' * (2500 if index == 0 else 1)}
          for index in range(30)],
        {'id': 'camera-note', 'type': 'content.text', 'text': '最后一张的实际内容'},
    ])
    async with canvas_client.canvas_sessions.begin() as db:
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'max_input_tokens': 4096}
    limited = dict(turn, request_id='large-text', text='分析 camera-note', context=dict(turn['context'], draft=large, scope='canvas'))
    result = await observe_canvas_turn(canvas_client, assistant, json=limited)
    assert result.receipt.status_code == 202, result.receipt.text
    supplied = next(item['content'] for item in reversed(requests[-1]['messages']) if item['role'] == 'user')
    assert '最后一张的实际内容' in supplied
    assert 'filler-00' not in supplied
    assert result.detail['context']['observed_card_ids'] == ['camera-note', 'target', 'basis']
    assert '本轮读取 3/33' in result.detail['reply']
    assert (await observe_canvas_turn(canvas_client, assistant, json=limited)).detail == result.detail

    chosen = await canvas_client.patch(append_canvas_path(url, '/assistant/model'), json={'model_id': 'tool-model'})
    assert chosen.status_code == 200, chosen.text
    result = await observe_canvas_turn(canvas_client, assistant, json=dict(
        limited, request_id='native-page', text='检查第二页',
        context=dict(limited['context'], scope='selection', card_ids=['target', 'basis', 'filler-00', 'filler-01']),
    ))
    assert result.receipt.status_code == 202, result.receipt.text
    assert result.detail['context']['observed_card_ids'] == ['basis', 'filler-00']
    assert '本轮读取 2/4' in result.detail['reply']



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
    reply = asyncio.create_task(observe_canvas_turn(canvas_client, assistant, json=message))
    try:
        await asyncio.wait_for(replying.wait(), 5)
        stopped = await canvas_client.post(assistant + '/turns/running-turn/stop')
        assert stopped.status_code == 200, stopped.text
        assert stopped.json()['data']['stopped']
    finally:
        proceed.set()
        await reply
    history = (await read_canvas_chat_snapshot(canvas_client, assistant)).json()['data']
    assert len(history['turns']) == 1
    assert history['turns'][0]['stopped'] and not history['turns'][0]['reply']
    assert (await observe_canvas_turn(canvas_client, assistant, json=message)).detail == history['turns'][0]


@pytest.mark.asyncio
@pytest.mark.parametrize('resume', [True, False])
async def test_resending_interrupted_assistant_turn_continues_completed_tool_step(canvas_client, monkeypatch, resume):
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
                'function': {'name': 'read_canvas', 'arguments': '{}'},
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
    outcome = await observe_canvas_turn(canvas_client, assistant, json=command)
    assert outcome.receipt.status_code == 202 and outcome.event['type'] == 'turn.interrupted'
    history = (await read_canvas_chat_snapshot(canvas_client, assistant)).json()['data']
    assert history['turns'] == []
    assert history['pending_request']['request_id'] == command['request_id']
    assert '模型未能完成回复' in history['pending_progress']['reply']
    assert history['pending_request']['context']['draft'] == command['context']['draft']
    follow_up = history['pending_request'] if resume else {**command, 'request_id': 'new-turn'}
    assert (await observe_canvas_turn(canvas_client, assistant, json=follow_up)).detail['reply'] == '已从中断处继续'
    refreshed = (await read_canvas_chat_snapshot(canvas_client, assistant)).json()['data']
    assert refreshed['pending_request'] is None
    if resume:
        assert calls == [False, True, True]
    else:
        assert [(turn['request_id']) for turn in refreshed['turns']] == ['resume-turn', 'new-turn']
        assert '模型未能完成回复' in refreshed['turns'][0]['reply']
        assert calls == [False, True, False, True]


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
    assert (await observe_canvas_turn(canvas_client, assistant, json={'request_id': 'long', 'text': long_text})).receipt.status_code == 202
    async with canvas_client.canvas_sessions.begin() as db:
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'max_input_tokens': 4096}

    response = await observe_canvas_turn(canvas_client, assistant, json={'request_id': 'short', 'text': '新问题'})
    assert response.receipt.status_code == 202, response.receipt.text
    assert prompts[-1] == ['新问题']
    too_large = await observe_canvas_turn(canvas_client, assistant, json={'request_id': 'long2', 'text': long_text})
    assert too_large.receipt.status_code == 202 and too_large.event['type'] == 'turn.interrupted'
    assert too_large.detail['error_code'] == 'ASSISTANT_CONTEXT_LIMIT_EXCEEDED'
    assert prompts == [[long_text], ['新问题']]
    history = (await read_canvas_chat_snapshot(canvas_client, assistant)).json()['data']
    assert len(history['turns']) == 2
    async with canvas_client.canvas_sessions.begin() as db:
        db.add(Model(id='large-window', name='large-window', category='text', provider_id='canvas-provider'))
    assert (await canvas_client.patch(assistant + '/model', json={'model_id': 'large-window'})).status_code == 200
    retried = (await observe_canvas_turn(canvas_client, assistant, json=history['pending_request'])).detail
    assert retried['request_id'] == 'long2' and retried['model_id'] == 'large-window'


@pytest.mark.asyncio
@pytest.mark.parametrize('native_tools', [True, False])
async def test_explicit_plan_uses_named_skills_without_available_writes(canvas_client, monkeypatch, native_tools):
    from app.models.llm import Model

    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported' if native_tools else 'unsupported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    original = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        assert all(not tool['function']['name'].startswith('propose_') for tool in body.get('tools', []))
        system = next(message['content'] for message in body['messages'] if message['role'] == 'system')
        assert '当前轮仅给出只读方案' in system
        assert '[专业技能 script-planning]' in system and '[专业技能 shot-staging]' in system
        answer = {'role': 'assistant', 'content': '保留 4 秒全景、7 秒动作、4 秒反应，合计 15 秒。'}
        if native_tools and not any(message['role'] == 'tool' for message in body['messages']):
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': 'context', 'type': 'function', 'function': {'name': 'read_canvas', 'arguments': '{}'},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'plan', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop',
                         'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    canvas = (await canvas_client.post('/canvases', json={'name': '计划'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    response = await observe_canvas_turn(canvas_client, url, json={
        'request_id': 'read-only-plan', 'text': '/plan /script-planning /shot-staging 把这一场压到 15 秒',
        'context': {'draft': canvas['document'], 'revision': canvas['revision'], 'scope': 'canvas'},
    })
    assert response.receipt.status_code == 202, response.receipt.text
    turn = response.detail
    assert turn['proposal'] is None and turn['generation'] is None
    assert [(skill['id'], skill['version']) for skill in turn['skills']] == [
        ('script-planning', '1.0.0'), ('shot-staging', '1.0.0'),
    ]
    assert (await canvas_client.get(url)).json()['data']['revision'] == canvas['revision']


@pytest.mark.asyncio
@pytest.mark.parametrize("canvas_client", ["app-handler-file"], indirect=True)
@pytest.mark.parametrize("outcome", ["completed", "interrupted", "stopped", "legacy"])
async def test_creative_question_resumes_original_turn_and_replays_answer(canvas_client, monkeypatch, outcome):
    import asyncio
    from app.models.llm import Model

    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    original = httpx.AsyncClient.send
    model_calls = []
    resumed, release = asyncio.Event(), asyncio.Event()

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        model_calls.append(body['messages'])
        tool_messages = [item for item in body['messages'] if item['role'] == 'tool']
        if tool_messages:
            assert '紧张逼近' in tool_messages[-1]['content']
            resumed.set()
            await release.wait()
            if outcome == 'interrupted':
                return httpx.Response(400, request=request, json={'error': {'message': 'rejected'}})
            answer = {'role': 'assistant', 'content': '保留紧张逼近的镜头。'}
        else:
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': 'ask-dramatic-intent', 'type': 'function',
                'function': {'name': 'ask_canvas_question', 'arguments': json.dumps({
                    'question': '这一段采用哪种情绪？', 'options': ['紧张逼近', '保持疏离'],
                }, ensure_ascii=False)},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'choice', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop',
                         'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    base = '/api/v1/studio'
    canvas = (await canvas_client.post(base + '/generation-canvases', json={'name': '选择叙事方向'})).json()['data']
    url = f"{base}/chat/sessions/{canvas['id']}"
    started = await canvas_client.post(url + '/turns', json={'request_id': 'same-turn', 'text': '设置场景情绪'})
    assert started.status_code == 202, started.text
    question_event = await wait_for_chat_event(canvas_client, url, 'same-turn', 'question.asked')
    question = question_event['detail']['question']
    assert question['options'] == ['紧张逼近', '保持疏离']

    body = {'question_id': question['id'], 'answer': '紧张逼近'}
    endpoint = url + '/turns/same-turn/answer'
    try:
        accepted = await asyncio.wait_for(canvas_client.post(endpoint, json=body), 2)
        assert accepted.status_code == 202, accepted.text
        receipt = accepted.json()['data']
        assert set(receipt) == {'session_id', 'turn_id', 'cursor'}
        assert receipt['turn_id'] == 'same-turn' and receipt['cursor'] >= question_event['cursor']
        await asyncio.wait_for(resumed.wait(), 4)
        replay = await canvas_client.get(url + '/events', params={'after': receipt['cursor'], 'follow': False})
        assert 'event: turn.accepted' in replay.text and 'event: turn.completed' not in replay.text
        assert (await canvas_client.post(endpoint, json=body)).json() == accepted.json()
        if outcome == 'stopped':
            stop = await canvas_client.post(f"{base}/chat/sessions/canvas/{canvas['id']}/turns/same-turn/stop")
            assert stop.status_code == 200 and stop.json()['data']['stopped']
    finally:
        release.set()
    terminal_kind = 'turn.interrupted' if outcome == 'interrupted' else 'turn.completed'
    terminal = await wait_for_chat_event(canvas_client, url, 'same-turn', terminal_kind, after=receipt['cursor'])
    if outcome in ('completed', 'legacy'):
        assert terminal['payload']['text'] == '保留紧张逼近的镜头。'
    expected_cursor = receipt['cursor']
    if outcome == 'legacy':
        from sqlalchemy import delete
        from app.models.canvas_assistant import CanvasAssistantEvent

        async with canvas_client.canvas_sessions.begin() as db:
            await db.execute(delete(CanvasAssistantEvent).where(
                CanvasAssistantEvent.canvas_id == canvas['id'], CanvasAssistantEvent.cursor == receipt['cursor'] + 1,
            ))
        expected_cursor = question_event['cursor']
    repeated = await canvas_client.post(endpoint, json=body)
    assert repeated.status_code == 202, repeated.text
    assert repeated.json()['data'] == {**receipt, 'cursor': expected_cursor}
    events = await read_canvas_events(canvas_client, url, after=expected_cursor)
    assert [event for event in events if event['type'] in ('question.asked', terminal_kind)] == [terminal]
    assert (await canvas_client.post(endpoint, json={**body, 'answer': '保持疏离'})).status_code == 409
    assert len(model_calls) == 2


@pytest.mark.asyncio
async def test_running_turn_refuses_new_messages_queue_and_steering(canvas_client, monkeypatch):
    from asyncio import Event, wait_for

    original = httpx.AsyncClient.send
    first_entered, release_first = Event(), Event()
    prompts = []

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        messages = json.loads(request.content)['messages']
        text = [item['content'] for item in messages if item['role'] == 'user'][-1]
        prompts.append(text)
        if len(prompts) == 1:
            first_entered.set()
            await release_first.wait()
        return httpx.Response(200, request=request, json={
            'id': 'steered', 'object': 'chat.completion', 'created': 1, 'model': 'canvas-text',
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': '原答复'}}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    canvas = (await canvas_client.post('/canvases', json={'name': '补充指令'})).json()['data']
    url = f"/canvases/{canvas['id']}/assistant"
    document = {**canvas['document'], 'cards': [
        {'id': 'shot-three', 'type': 'content.text', 'text': '第三镜头'},
        {'id': 'shot-four', 'type': 'content.text', 'text': '第四镜头'},
    ], 'groups': [
        {'id': 'group-three', 'name': '镜头三', 'card_ids': ['shot-three']},
        {'id': 'group-four', 'name': '镜头四', 'card_ids': ['shot-four']},
    ]}
    request = {'request_id': 'active', 'text': '检查镜头后生成一版',
        'context': {'draft': document, 'revision': canvas['revision'], 'scope': 'auto', 'card_ids': ['shot-four']}}
    unresolved = await observe_canvas_turn(canvas_client, url, json={**request, 'request_id': 'unresolved', 'text': '修改镜头 99'})
    assert unresolved.receipt.status_code == 422 and unresolved.receipt.json()['detail'] == 'CANVAS_TARGET_UNRESOLVED'
    session = canvas_chat_url(url)
    admitted = await canvas_client.post(session + '/turns', json=request)
    assert admitted.status_code == 202
    try:
        await wait_for(first_entered.wait(), timeout=4)
        repeated = await canvas_client.post(session + '/turns', json=request)
        assert repeated.status_code == 202 and repeated.json() == admitted.json()
        accepted, = [event for event in await read_canvas_events(canvas_client, url)
                     if event['type'] == 'turn.accepted']
        assert accepted['type'] == 'turn.accepted' and accepted['detail']['progress']['streaming']
        other = {'request_id': 'next', 'text': '新的问题'}
        assert (await observe_canvas_turn(canvas_client, url, json=other)).receipt.status_code == 409
        assert (await canvas_client.post(url + '/queue', json=other)).status_code in (404, 405, 409, 410)
        assert (await canvas_client.post(url + '/turns/active/steer', json=other)).status_code in (404, 405, 409, 410)
        other_canvas = (await canvas_client.post('/canvases', json={'name': '其他会话'})).json()['data']
        assert (await observe_canvas_turn(canvas_client, f"/canvases/{other_canvas['id']}/assistant", json=other)).receipt.status_code == 202
    finally:
        release_first.set()
    completed = await wait_for_chat_event(canvas_client, session, 'active', 'turn.completed')
    assert (await observe_canvas_turn(canvas_client, url, json=request)).detail == completed['detail']
    assert len(prompts) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('native_tools', [True, False])
async def test_registered_specialists_keep_independent_work_when_review_fails(canvas_client, monkeypatch, native_tools):
    from app.models.llm import Model

    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported' if native_tools else 'unsupported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    canvas = (await canvas_client.post('/canvases', json={'name': '专项任务'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    original = httpx.AsyncClient.send
    consulted = []
    tasks = [
        {'id': 'footage', 'role': 'footage-continuity-review', 'task': '审看素材'},
        {'id': 'independent', 'role': 'storyboard-design', 'task': '规划独立的节拍'},
        {'id': 'dependent', 'role': 'storyboard-design', 'task': '使用审看片段调整镜头', 'depends_on': ['footage']},
    ]

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        system = next(item['content'] for item in body['messages'] if item['role'] == 'system')
        observed = {item['tool_call_id'] for item in body['messages'] if item['role'] == 'tool'}
        answer = {'role': 'assistant', 'content': '汇总已交付的专项结果'}
        if '不得写入画布、审批、提交生成或继续委派' in system:
            assert not body.get('tools')
            task = json.loads(body['messages'][-1]['content'])['任务']
            consulted.append(task)
            answer['content'] = '可保留一个独立反应镜头' if task.startswith('规划') else ''
        elif not native_tools:
            if '请复核并综合' in body['messages'][-1]['content']:
                facts = body['messages'][-1]['content']
                assert '可保留一个独立反应镜头' in facts and '"status": "blocked"' in facts
                answer['content'] = '主助手复核：可保留独立镜头，素材审看未完成。'
            else:
                answer['content'] = json.dumps({'delegations': tasks}, ensure_ascii=False)
        elif 'delegate' not in observed:
            name, key, args = ('delegate_canvas_tasks', 'delegate', {'tasks': tasks}) if observed else (
                'read_canvas', 'read', {},
            )
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': key, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'delegate', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop',
                         'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    sent = await observe_canvas_turn(canvas_client, url, json={
        'request_id': 'split-specialists', 'text': '准备分镜并审看片段',
        'context': {'draft': canvas['document'], 'revision': canvas['revision'], 'scope': 'canvas'},
    })
    assert sent.receipt.status_code == 202, sent.receipt.text
    result = sent.detail
    assert result['proposal'] is None
    assert {entry['id']: entry['status'] for entry in result['subtasks']} == {
        'footage': 'failed', 'independent': 'completed', 'dependent': 'blocked',
    }
    if not native_tools:
        assert result['reply'].startswith('主助手复核')
    assert sorted(consulted) == ['审看素材', '规划独立的节拍']
    assert (await read_canvas_chat_snapshot(canvas_client, url)).json()['data']['turns'][0]['subtasks'] == result['subtasks']


@pytest.mark.asyncio
async def test_cross_canvas_reference_observes_allowed_source_and_rejects_other_scope(canvas_client, monkeypatch):
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    primary = (await canvas_client.post('/canvases', json={'name': '当前画布'})).json()['data']
    source = (await canvas_client.post('/canvases', json={'name': '来源画布'})).json()['data']
    hidden = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '项目内分镜'})).json()['data']
    updated = await canvas_client.put(f"/canvases/{source['id']}", json={
        'request_id': 'set-evidence', 'expected_revision': source['revision'],
        'document': {**source['document'], 'cards': [{'id': 'notes', 'type': 'content.text', 'text': '海面在晨雾里'}],
                     'groups': [{'id': 'coast', 'name': '岸边', 'card_ids': ['notes']}]},
    })
    assert updated.status_code == 200, updated.text
    original = httpx.AsyncClient.send
    prompt = []

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        prompt.append(body['messages'][-1]['content'])
        assert not body.get('tools')
        return httpx.Response(200, request=request, json={
            'id': 'cross', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'stop',
                         'message': {'role': 'assistant', 'content': '建议回来源画布调整对比度'}}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    url = f"/canvases/{primary['id']}/assistant"
    message = {'request_id': 'analysis', 'text': '用这张卡给建议',
               'canvas_references': [{'canvas_id': source['id'], 'card_ids': ['notes'],
                                      'groups': [{'id': 'coast', 'name': '岸边', 'card_ids': ['notes']}]}]}
    allowed = await observe_canvas_turn(canvas_client, url, json=message)
    assert allowed.receipt.status_code == 202, allowed.receipt.text
    assert '海面在晨雾里' in prompt[0] and '岸边' in prompt[0]
    assert allowed.detail['canvas_references'] == message['canvas_references']
    assert allowed.detail['proposal'] is None
    assert (await observe_canvas_turn(canvas_client, url, json=message)).detail == allowed.detail
    denied = await observe_canvas_turn(canvas_client, url, json={
        **message, 'request_id': 'denied', 'canvas_references': [{'canvas_id': hidden['id'], 'card_ids': ['notes']}],
    })
    assert denied.receipt.status_code == 404, denied.receipt.text
    assert len(prompt) == 1

@pytest.mark.asyncio
@pytest.mark.parametrize('stop', [False, True])
async def test_visible_reply_precedes_completion_and_survives_reconnect(canvas_client, monkeypatch, stop):
    released, paused = asyncio.Event(), asyncio.Event()
    original = httpx.AsyncClient.send

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for content in ['## 第一段', '\n第二段']:
                data = {'id': 's', 'model': 'canvas-text', 'choices': [
                    {'index': 0, 'delta': {'role': 'assistant', 'content': content}, 'finish_reason': None}]}
                yield ('data: ' + json.dumps(data) + '\n\n').encode()
                paused.set()
                await released.wait()
            yield b'data: [DONE]\n\n'

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        assert json.loads(request.content)['stream']
        return httpx.Response(200, request=request, headers={'content-type': 'text/event-stream'}, stream=Stream())

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'test-key'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    canvas = (await canvas_client.post('/canvases', json={'name': '流式回归'})).json()['data']
    url = '/canvases/' + canvas['id'] + '/assistant'
    session = canvas_chat_url(url)
    response = await canvas_client.post(session + '/turns', json={
        'text': '给我建议', 'request_id': 'live', 'stream_reply': True,
    })
    assert response.status_code == 202, response.text
    cursor = response.json()['data']['cursor']
    try:
        await asyncio.wait_for(paused.wait(), 3)
        delta = await wait_for_chat_event(canvas_client, session, 'live', 'message.updated', after=cursor)
        assert delta['payload']['text'] == '## 第一段'
        assert not any(event['type'] == 'turn.completed' for event in await read_canvas_events(canvas_client, url))
        if stop:
            result = await canvas_client.post(url + '/turns/live/stop')
            assert result.status_code == 200, result.text
    finally:
        released.set()
    final = await wait_for_chat_event(canvas_client, session, 'live', 'turn.completed', after=delta['cursor'])
    assert final['payload']['text'] == ('## 第一段' if stop else '## 第一段\n第二段')
