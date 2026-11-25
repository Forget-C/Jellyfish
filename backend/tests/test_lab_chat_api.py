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


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
@pytest.mark.parametrize('action', ['submit', 'wait', 'fail', 'stop'])
async def test_chat_model_submits_requested_image_and_receives_task_receipt(canvas_client, monkeypatch, action):
    import asyncio
    from app.task_worker import TaskWorker
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        (await db.get(Model, 'canvas-text')).capability_profile = {
            'tool_calling': {'declaration': 'supported'}, 'native_streaming': {'declaration': 'unsupported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text', default_image_model_id='canvas-image'))
    original = httpx.AsyncClient.send
    calls = []

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test' or 'chat/completions' not in request.url.path:
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        calls.append(body)
        assert [tool['function']['name'] for tool in body['tools']] == ['generate_image', 'generate_video']
        if body['messages'][-1]['role'] == 'tool':
            assert body['messages'][-1]['tool_call_id'] == 'rain-one'
            answer = {'role': 'assistant', 'content': '已提交'}
        else:
            answer = {'role': 'assistant', 'tool_calls': [{'id': 'rain-one', 'type': 'function',
                'function': {'name': 'generate_image', 'arguments': json.dumps({'prompt': 'rain', 'submit_only': action == 'submit'})}}]}
        return httpx.Response(200, request=request, json={'choices': [{'index': 0,
            'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop', 'message': answer}]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    created = await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})
    url = '/api/v1/studio/chat/sessions/lab/' + created.json()['data']['id']
    body = {'request_id': 'illustrate', 'text': '给雨夜街景配幅插画，只提交任务'}
    sending = asyncio.create_task(canvas_client.post(url + '/turns', json=body))
    if action != 'submit':
        async with asyncio.timeout(8):
            while True:
                snap = (await canvas_client.get(url)).json()['data']
                if any(m['role'] == 'task' for m in snap['messages']):
                    break
                await asyncio.sleep(.04)
        assert snap['active_turn'] == 'illustrate'
        if action == 'stop':
            await canvas_client.post(url + '/turns/illustrate/stop')
        else:
            from botocore.exceptions import ClientError

            async def head(**_):
                raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'HeadObject')

            monkeypatch.setattr('app.core.storage.get_file_info', head)

            def generate(request):
                assert json.loads(request.content)['prompt'] == 'rain'
                if action == 'fail':
                    return httpx.Response(400, json={'error': {'message': 'invalid prompt'}})
                return httpx.Response(200, json={'data': [{'b64_json': 'YQ=='}]})
            async with httpx.AsyncClient(transport=httpx.MockTransport(generate)) as http:
                worker = TaskWorker(canvas_client.canvas_sessions, client=http)
                try:
                    await worker.tick()
                    await asyncio.gather(*list(worker.jobs.values()))
                finally:
                    worker.text_pool.shutdown(wait=True)
    result = await asyncio.wait_for(sending, 8)
    assert result.status_code == 200, result.text
    snap = (await canvas_client.get(url)).json()['data']
    assert snap['active_turn'] is None
    task, = [m for m in snap['messages'] if m['role'] == 'task']
    receipt = task['media_receipt']
    assert receipt['model_id'] == 'canvas-image'
    if action == 'wait':
        assert receipt['status'] == 'succeeded', receipt['error']
        artifact, = receipt['artifacts']
        assert artifact['file_id'] in calls[-1]['messages'][-1]['content']
    elif action == 'fail':
        assert receipt['status'] == 'failed'
    else:
        assert task['status'] == 'queued'
    assert (await canvas_client.post(url + '/turns', json=body)).status_code == 200
    assert len(calls) == (1 if action == 'stop' else 2)
    events = (await canvas_client.get(url + '/events', params={'follow': False})).text
    assert 'event: task.accepted' in events
    if action != 'stop':
        assert ('event: tool.failed' if action == 'fail' else 'event: tool.completed') in events


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
@pytest.mark.parametrize('with_tools,error', [(False, 'CHAT_TOOL_MODEL_REQUIRED'), (True, 'CHAT_IMAGE_MODEL_REQUIRED')])
async def test_image_command_requires_selected_models_before_admission(canvas_client, with_tools, error):
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Model, 'canvas-text')).capability_profile = {
            'tool_calling': {'declaration': 'supported' if with_tools else 'unsupported'}}
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
    session = await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})
    url = '/api/v1/studio/chat/sessions/lab/' + session.json()['data']['id']
    result = await canvas_client.post(url + '/turns', json={'text': '/imagegen 雨夜', 'request_id': 'request'})
    assert result.status_code == 422 and error in result.text
    assert not (await canvas_client.get(url)).json()['data']['messages']


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
@pytest.mark.parametrize('action', ['wait', 'submit', 'stop', 'fail', 'cancel', 'analyze'])
async def test_chat_video_uses_attached_first_frame(canvas_client, monkeypatch, action):
    import asyncio
    import base64
    from botocore.exceptions import ClientError
    from app.task_worker import TaskWorker

    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        (await db.get(Model, 'canvas-text')).capability_profile = {
            'image_inputs': {'declaration': 'unsupported'}, 'tool_calling': {'declaration': 'supported'},
            'native_streaming': {'declaration': 'unsupported'}}
        db.add(Provider(id='video-provider', provider_key='vidu', name='Vidu', api_key='local', base_url='https://video.test'))
        await db.flush()
        video = await db.get(Model, 'canvas-video')
        video.name, video.provider_id = 'viduq2', 'video-provider'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text', default_video_model_id=video.id))
    blobs = {}
    async def upload(*, key, data, **kwargs):
        blobs[key] = data.read()
    async def download(*, key):
        return blobs[key]
    monkeypatch.setattr('app.core.storage.upload_file', upload)
    monkeypatch.setattr('app.core.storage.download_file', download)
    frame = b'rain at night'
    uploaded = await canvas_client.post('/api/v1/studio/files/upload', files={'file': ('rain.png', frame, 'image/png')})
    frame_id = uploaded.json()['data']['id']
    original = httpx.AsyncClient.send
    results = []

    async def chat(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        messages = json.loads(request.content)['messages']
        if action == 'analyze':
            answer = {'role': 'assistant', 'content': '无法查看图片'}
        elif messages[-1]['role'] == 'tool':
            results.append(json.loads(messages[-1]['content']))
            answer = {'role': 'assistant', 'content': '任务回执已收到'}
        else:
            assert frame_id in json.dumps(messages) and 'image_url' not in json.dumps(messages)
            answer = {'role': 'assistant', 'tool_calls': [{'id': 'shot', 'type': 'function', 'function': {
                'name': 'generate_video', 'arguments': json.dumps({'prompt': 'push in', 'seconds': 4,
                    'first_frame_id': frame_id, 'submit_only': action == 'submit'})}}]}
        return httpx.Response(200, request=request, json={'choices': [{'index': 0, 'message': answer,
                'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop'}]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', chat)
    session = await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})
    url = '/api/v1/studio/chat/sessions/lab/' + session.json()['data']['id']
    body = {'request_id': 'film', 'text': ('/videogen ' if action == 'submit' else '') + '把附件用作首帧推进4秒',
            'file_ids': [frame_id]}
    if action == 'analyze':
        response = await canvas_client.post(url + '/turns', json={**body, 'text': 'Describe the colors in my attachment'})
        assert response.status_code == 422 and 'ASSISTANT_MODEL_INPUT_UNSUPPORTED' in response.text, response.text
        return
    sending = asyncio.create_task(canvas_client.post(url + '/turns', json=body))
    async with asyncio.timeout(8):
        while True:
            if sending.done():
                sent = sending.result()
                assert sent.is_success, sent.text
            snap = (await canvas_client.get(url)).json()['data']
            tasks = [m for m in snap['messages'] if m['role'] == 'task']
            if tasks:
                break
            await asyncio.sleep(.05)
    task_id = tasks[0]['task_id']
    if action == 'stop':
        await canvas_client.post(url + '/turns/film/stop')
    elif action == 'cancel':
        cancel = await canvas_client.post(f'/api/v1/film/tasks/{task_id}/cancel', json={'reason': 'user_cancelled'})
        assert cancel.is_success, cancel.text
    elif action in ('wait', 'fail'):
        async def head(**_):
            raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'HeadObject')
        monkeypatch.setattr('app.core.storage.get_file_info', head)
        submissions = []
        def provider(request):
            if request.method == 'GET':
                return httpx.Response(200, json={'state': 'success', 'creations': [{'b64_json': 'dg=='}]})
            submissions.append(json.loads(request.content))
            return httpx.Response(400 if action == 'fail' else 200, json={'task_id': 'remote-video'})
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
            worker = TaskWorker(canvas_client.canvas_sessions, client=http)
            try:
                for _ in range(2):
                    await worker.tick()
                    await asyncio.gather(*list(worker.jobs.values()))
            finally:
                worker.text_pool.shutdown(wait=True)
        post, = submissions
        assert (post['model'], post['duration']) == ('viduq2', 4)
        assert post['images'] == ['data:image/png;base64,' + base64.b64encode(frame).decode()]
    sent = await asyncio.wait_for(sending, 8)
    assert sent.is_success, sent.text
    if action != 'stop':
        receipt, = results
        assert receipt['status'] == {'submit': 'queued', 'wait': 'succeeded', 'fail': 'failed', 'cancel': 'cancelled'}[action]
        assert receipt['tool_call_id'] == 'shot' and receipt['model_id'] == 'canvas-video'
        if action == 'wait':
            assert receipt['artifacts'][0]['file_id']
    else:
        assert not results
