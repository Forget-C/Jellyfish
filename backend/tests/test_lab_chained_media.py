"""Exercise chained media via the chat API, controlled providers and the real task worker."""
import asyncio
import base64
import json

import httpx
import pytest
from botocore.exceptions import ClientError

from app.models.llm import Model, ModelSettings, Provider
from app.task_worker import TaskWorker
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
@pytest.mark.parametrize('interruption', ['none', 'image-accepted', 'before-video', 'lease-takeover', 'video-fails', 'acceptance-unknown', 'stop'])
async def test_chain_uses_archived_image_as_video_frame(canvas_client, monkeypatch, interruption):
    sessions = canvas_client.canvas_sessions
    async with sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        (await db.get(Model, 'canvas-text')).capability_profile = {
            'tool_calling': {'declaration': 'supported'}, 'native_streaming': {'declaration': 'unsupported'}}
        db.add(Provider(id='vidu', provider_key='vidu', name='video', api_key='key', base_url='https://video.test'))
        await db.flush()
        video = await db.get(Model, 'canvas-video')
        video.name, video.provider_id = 'viduq2', 'vidu'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text', default_image_model_id='canvas-image',
                             default_video_model_id=video.id))
    frame = base64.b64encode(b'archived rainy street').decode()
    blobs = {}
    async def upload(*, key, data, **_):
        blobs[key] = data.read()
    async def download(*, key):
        return blobs[key]
    async def head(**_):
        raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'HeadObject')
    monkeypatch.setattr('app.core.storage.upload_file', upload)
    monkeypatch.setattr('app.core.storage.download_file', download)
    monkeypatch.setattr('app.core.storage.get_file_info', head)
    original = httpx.AsyncClient.send
    def call(name, identity, **args):
        return {'role': 'assistant', 'tool_calls': [{'id': identity, 'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(args)}}]}
    at_handoff = asyncio.Event()
    async def chat(client, request, **kwargs):
        if request.url.host != 'example.test' or 'chat/completions' not in request.url.path:
            return await original(client, request, **kwargs)
        last = json.loads(request.content)['messages'][-1]
        if last['role'] != 'tool':
            answer = call('generate_image', 'rain', prompt='雨夜街景')
        elif last['tool_call_id'] == 'rain':
            if interruption == 'before-video' and not at_handoff.is_set():
                at_handoff.set()
                await asyncio.Event().wait()
            result = json.loads(last['content'])
            answer = call('generate_video', 'push', prompt='推进', seconds=5,
                          first_frame_id=result['artifacts'][0]['file_id'])
        else:
            answer = {'role': 'assistant', 'content': '成片已归档'}
        return httpx.Response(200, request=request, json={'choices': [{'index': 0, 'message': answer,
            'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop'}]})
    monkeypatch.setattr(httpx.AsyncClient, 'send', chat)
    takeover = False
    posts = []
    def provider(request):
        if request.method == 'GET':
            return httpx.Response(200, json={'state': 'success', 'creations': [{'b64_json': 'dg=='}]})
        params = json.loads(request.content)
        posts.append(params)
        if params['model'] == 'canvas-image':
            return httpx.Response(200, json={'data': [{'b64_json': frame}]})
        if interruption == 'acceptance-unknown':
            raise httpx.ReadError('connection lost after request', request=request)
        if interruption == 'video-fails':
            return httpx.Response(400, json={'error': '拒绝生成'})
        return httpx.Response(200, json={'task_id': 'remote-video'})
    created = await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})
    url = '/api/v1/studio/chat/sessions/' + created.json()['data']['id']
    lab_url = '/api/v1/studio/chat/sessions/lab/' + created.json()['data']['id']
    body = {'request_id': 'rainy-street', 'text': '先画雨夜街景，再用这张图做一个 5 秒推进镜头'}
    sending = asyncio.create_task(canvas_client.post(url + '/turns', json=body))
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
        worker = TaskWorker(sessions, client=http)
        try:
            async with asyncio.timeout(12):
                while True:
                    await asyncio.sleep(.05)
                    state = (await canvas_client.get(lab_url)).json()['data']
                    tasks = [m for m in state['messages'] if m['role'] == 'task']
                    if tasks and interruption == 'lease-takeover' and not takeover:
                        # Simulate an unresponsive HTTP process. The worker owns recovery after the lease expires.
                        from datetime import timedelta
                        from app.services.chat import turn_recovery
                        clock = turn_recovery.now
                        monkeypatch.setattr(turn_recovery, 'now', lambda: clock() + timedelta(minutes=2))
                        takeover = True
                    if tasks and not takeover and (
                            interruption == 'image-accepted' or interruption == 'before-video' and at_handoff.is_set()):
                        # Force the durable lease to expire while the detached execution is paused.
                        from datetime import timedelta
                        from app.services.chat import turn_recovery
                        clock = turn_recovery.now
                        monkeypatch.setattr(turn_recovery, 'now', lambda: clock() + timedelta(minutes=2))
                        takeover = True
                        assert (await sending).status_code == 202
                        retry = await canvas_client.post(url + '/turns', json=body)
                        assert retry.json()['data']['turn_id'] == 'rainy-street'
                    if (interruption == 'acceptance-unknown' and tasks
                            and tasks[-1]['media_receipt']['stage'] == 'submission_unknown'):
                        retry = await canvas_client.post(url + '/turns', json=body)
                        assert retry.json()['data']['turn_id'] == 'rainy-street'
                        worker.text_pool.shutdown(wait=True)
                        worker = TaskWorker(sessions, client=http)
                        await worker.tick()
                        await asyncio.gather(*list(worker.jobs.values()))
                        await canvas_client.post(lab_url + '/turns/rainy-street/stop')
                        assert [p['model'] for p in posts] == ['canvas-image', 'viduq2']
                        assert (await sending).is_success
                        return
                    if interruption == 'stop' and tasks and state['active_turn']:
                        await canvas_client.post(lab_url + '/turns/rainy-street/stop')
                    if not state['active_turn'] and tasks and all(m['status'] in ('succeeded', 'failed') for m in tasks):
                        break
                    if sending.done() and not sending.cancelled():
                        assert sending.result().is_success, sending.result().text
                    await worker.tick()
                    await asyncio.gather(*list(worker.jobs.values()))
        finally:
            worker.text_pool.shutdown(wait=True)
    if not sending.cancelled():
        assert (await sending).is_success
    messages = state['messages']
    if interruption == 'stop':
        assert [p['model'] for p in posts] == ['canvas-image']
        assert messages[-1]['status'] == 'stopped'
        return
    assert [p['model'] for p in posts] == ['canvas-image', 'viduq2']
    assert posts[1]['duration'] == 5
    assert posts[1]['images'] == ['data:image/png;base64,' + frame]
    assert messages[-1]['content'] == '成片已归档'
    assert [m['media_receipt']['status'] for m in messages if m['role'] == 'task'] == [
        'succeeded', 'failed' if interruption == 'video-fails' else 'succeeded']
    events = (await canvas_client.get(url + '/events?follow=false')).text
    assert events.count('event: artifact.created') == (1 if interruption == 'video-fails' else 2)
    assert events.count('event: task.accepted') == 2
    assert events.count('event: tool.started') == 2
    assert events.count('event: tool.completed') == (1 if interruption == 'video-fails' else 2)
