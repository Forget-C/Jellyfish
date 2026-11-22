"""Assistant follow-up and stop at the canvas HTTP and Worker boundaries."""

import asyncio
import json

import httpx
import pytest

from app.models.llm import Model, ModelSettings
from app.task_worker import TaskWorker
from tests.test_generation_canvas_runs import runtime  # pylint: disable=unused-import
from tests.test_generation_canvas_images import image_storage  # pylint: disable=unused-import
from tests.test_canvas_assistant_edit_api import _live_mysql_app


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['independent', pytest.param('mysql', marks=pytest.mark.integration)], indirect=True)
@pytest.mark.parametrize('action', ['stop', 'cancel'])
async def test_stop_keeps_accepted_run_across_worker_restart(runtime, monkeypatch, request, tmp_path, action):
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}}
        settings = await db.get(ModelSettings, 1)
        if settings is None:
            settings = ModelSettings(id=1)
            db.add(settings)
        settings.default_text_model_id = model.id
    original = httpx.AsyncClient.send
    started, release = asyncio.Event(), asyncio.Event()

    async def respond(client, request, **kwargs):
        if request.url.host != 'frozen.test':
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        if body.get('stream'):
            started.set()
            await release.wait()
            chunk = {'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': 'Result'}}]}
            return httpx.Response(200, request=request, text=f'data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n')
        message = {'role': 'assistant', 'content': '已收到指令'}
        if not any(item['role'] == 'tool' for item in body['messages']):
            message = {'role': 'assistant', 'tool_calls': [{'id': 'scope', 'type': 'function',
                'function': {'name': 'read_canvas_context', 'arguments': '{}'}}]}
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in message else 'stop',
                         'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    current = (await runtime.client.get(runtime.url)).json()['data']
    endpoint, _, query = runtime.url.partition('?')
    suffix = '?' + query if query else ''
    assistant = endpoint + '/assistant' + suffix
    stop = endpoint + '/assistant/turns/review-one/stop' + suffix
    runs = endpoint + '/runtime' + suffix
    sent = await runtime.client.post(assistant, json={
        'request_id': 'review-one', 'text': '生成一版，完成后看看动作是否连贯',
        'context': {'draft': current['document'], 'revision': current['revision'],
                    'scope': 'selection', 'card_ids': ['m']},
    })
    assert sent.status_code == 200, sent.text
    async with httpx.AsyncClient() as transport:
        first = TaskWorker(runtime.sessions, client=transport)
        try:
            await first.tick()
            await asyncio.wait_for(started.wait(), timeout=10)
            if action == 'cancel':
                run_id = (await runtime.client.get(runs)).json()['data']['runs'][0]['id']
                cancelled = await runtime.client.post(endpoint + f'/runs/{run_id}/cancel' + suffix)
                assert cancelled.status_code == 200, cancelled.text
                assert cancelled.json()['data']['nodes'][0]['run_id'] == run_id
            else:
                stopped = await runtime.client.post(stop)
                assert stopped.status_code == 200, stopped.text
                status = stopped.json()['data']
                assert status['generation']['review']['state'] == 'stopped'
                assert status['generation']['versions'][0]['state'] == 'running'
        finally:
            release.set()
            await asyncio.gather(*first.jobs.values())
            first.text_pool.shutdown(wait=False)

        if action == 'cancel' or request.node.callspec.params['runtime'] != 'mysql':
            resumed = TaskWorker(runtime.sessions, client=transport)
            task = asyncio.create_task(resumed.run())
            try:
                await asyncio.sleep(1.1)
            finally:
                resumed.stopping.set()
                await task

    if action == 'stop' and request.node.callspec.params['runtime'] == 'mysql':
        async with _live_mysql_app(tmp_path) as restarted:
            await asyncio.sleep(1.1)
            path = assistant.replace('/canvases/', '/api/v1/studio/generation-canvases/', 1)
            live_history = (await restarted.get(path)).json()['data']['turns']
            assert live_history[0]['generation']['review'] == {'state': 'stopped', 'results': []}
    history = (await runtime.client.get(assistant)).json()['data']['turns']
    assert len(history) == 1
    generation = history[0]['generation']
    published = (await runtime.client.get(runs)).json()['data']['runs']
    assert len(published) == 1
    if action == 'stop':
        assert generation['state'] == 'completed'
        assert generation['review'] == {'state': 'stopped', 'results': []}
        assert published[0]['nodes'][0]['status'] == 'succeeded'
    else:
        assert generation['state'] == 'failed'
        assert generation['review']['state'] == 'completed'
        result, = generation['review']['results']
        assert result['run_id'] == published[0]['id']
        assert result['evidence'] == [] and '生成已取消' in result['reply']


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['independent'], indirect=True)
@pytest.mark.parametrize('followup', [True, False])
async def test_worker_reviews_only_the_authorized_immutable_generation(runtime, image_storage, monkeypatch, followup):
    import base64
    from io import BytesIO

    from PIL import Image

    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.capability_profile = {'tool_calling': {'declaration': 'supported'},
                                    'image_inputs': {'declaration': 'supported'}}
        db.add(Model(id='followup-image', name='image-model', category='image', provider_id=runtime.provider_id))
        db.add(ModelSettings(id=1, default_text_model_id=model.id))

    current = (await runtime.client.get(runtime.url)).json()['data']
    document = current['document']
    document['cards'][0].update(
        id='review-image', type='model.image', model_id='followup-image',
        config={'count': 1, 'target_ratio': '1:1', 'resolution_profile': 'standard'},
    )
    saved = await runtime.client.put(runtime.url, json={'request_id': 'image', 'expected_revision': current['revision'],
                                                        'document': document})
    assert saved.status_code == 200, saved.text
    current = (await runtime.client.get(runtime.url)).json()['data']
    assistant = runtime.url + '/assistant'
    runs = runtime.url + '/runtime'
    reviews = []
    provider_runs = []
    png = BytesIO()
    Image.new('RGB', (16, 16), 'red').save(png, 'PNG')
    original = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'frozen.test':
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        if request.url.path.endswith('/images/generations'):
            provider_runs.append(body)
            return httpx.Response(200, request=request, json={'data': [
                {'b64_json': base64.b64encode(png.getvalue()).decode()},
            ]})
        is_review = any(isinstance(item.get('content'), list)
                        and any(part['type'] == 'image_url' for part in item['content'])
                        for item in body['messages'])
        used_tools = [item for item in body['messages'] if item['role'] == 'tool']
        if is_review and not used_tools:
            reviews.append(body)
            name, args = 'load_canvas_skill', '{"skill_id":"footage-review"}'
        elif not is_review and not used_tools:
            name, args = 'read_canvas_context', '{}'
        else:
            name = None
        message = {'role': 'assistant', 'content': '成片中的主色是红色。' if is_review else '已收到指令'}
        if name:
            message = {'role': 'assistant', 'tool_calls': [{'id': name, 'type': 'function',
                'function': {'name': name, 'arguments': args}}]}
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if name else 'stop', 'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    sent = await runtime.client.post(assistant, json={
        'request_id': 'review-one', 'text': '生成一版，完成后审看构图' if followup else '生成一版',
        'context': {'draft': current['document'], 'revision': current['revision'],
                    'scope': 'selection', 'card_ids': ['review-image']},
    })
    assert sent.status_code == 200, sent.text
    assert bool(sent.json()['data']['generation']['review']) is followup
    # The worker completes and reviews the run before the assistant conversation is reopened.
    async with httpx.AsyncClient() as transport:
        worker = TaskWorker(runtime.sessions, client=transport)
        task = asyncio.create_task(worker.run())
        try:
            async with asyncio.timeout(12):
                while True:
                    history = (await runtime.client.get(assistant)).json()['data']['turns']
                    generation = history[0]['generation']
                    if generation['state'] == 'completed' and (
                        not followup or generation['review']['state'] == 'completed'
                    ):
                        break
                    await asyncio.sleep(0.1)
        finally:
            worker.stopping.set()
            await task
    assert len(provider_runs) == 1
    assert len(reviews) == int(followup)
    published = (await runtime.client.get(runs)).json()['data']['runs']
    assert len(published) == 1
    if followup:
        result, = generation['review']['results']
        assert result['run_id'] == published[0]['id']
        assert result['version'] == 1 and result['reply'] == '成片中的主色是红色。'
        assert result['evidence'][0]['file_id'] == published[0]['nodes'][0]['outputs'][0]['file_id']
        assert result['evidence'][0]['observation'] == 'image'
    else:
        assert generation['review'] is None
