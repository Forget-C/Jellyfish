"""Sequential public HTTP journey: references are created only after real outputs."""
import asyncio
import base64
import json
from types import SimpleNamespace

import httpx
import pytest
from app.models.llm import Model, Provider
from app.task_worker import TaskWorker
from tests.canvas_prompt_fixtures import bind_document_prompts
from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', [None, 'mysql'], indirect=True)
async def test_text_then_image_then_video_uses_completed_outputs_and_preview(runtime, image_storage, monkeypatch):
    async with runtime.sessions.begin() as db:
        db.add(Provider(id=runtime.provider_id + '-video', provider_key='volcengine', name='volcengine', base_url='https://video.test/v1', api_key='video-secret'))
        await db.flush()
        db.add(Model(id=runtime.model_id + '-image', name='image-model', category='image', provider_id=runtime.provider_id))
        db.add(Model(id=runtime.model_id + '-video', name='doubao-seedance', category='video', provider_id=runtime.provider_id + '-video'))
    prompts, calls = [], []
    class TextModel:
        def __init__(self, **_kwargs):
            pass
        async def astream(self, messages):
            prompts.append(messages[0].content)
            yield SimpleNamespace(content='A red boat ')
            yield SimpleNamespace(content='on a quiet lake')
    monkeypatch.setattr('app.task_worker.build_langchain_chat', TextModel)
    def external(request):
        calls.append(request)
        if request.url.host == 'frozen.test':
            return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'generated-boat-image').decode()}]})
        if request.method == 'POST':
            return httpx.Response(200, json={'id': 'boat-video'})
        if request.url.host == 'video.test':
            return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://media.test/boat.mp4'}})
        return httpx.Response(200, content=b'video-with-original-audio', headers={'Content-Type': 'video/mp4'})
    async def snapshot():
        response = await runtime.client.get(runtime.url + '/runtime')
        assert response.status_code == 200, response.text
        return response.json()['data']
    async def save(name):
        current = (await runtime.client.get(runtime.url)).json()['data']
        response = await runtime.client.put(runtime.url, json={'request_id': name, 'expected_revision': current['revision'], 'document': bind_document_prompts(runtime.document)})
        assert response.status_code == 200, response.text
    def reference(source, port):
        return {'id': 'ref-' + source, 'kind': 'reference', 'source': {'canvas_id': runtime.canvas_id, 'card_id': source, 'port_id': port, 'position': 0}}
    async with httpx.AsyncClient(transport=httpx.MockTransport(external)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        try:
            async def run(card):
                response = await runtime.client.post(runtime.url + '/precheck', json={'card_id': card})
                preview = response.json()['data']
                assert preview['can_run'], preview
                body = {'request_id': 'run-' + card, 'preview_token': preview['preview_token']}
                accepted = await runtime.client.post(runtime.url + '/runs', json=body)
                assert accepted.status_code == 200, accepted.text
                # A lost acknowledgement can be replayed without another Task.
                assert (await runtime.client.post(runtime.url + '/runs', json=body)).json() == accepted.json()
                for _ in range(8):
                    await worker.tick()
                    await asyncio.gather(*worker.jobs.values())
                    await asyncio.sleep(.05)
                    state = await snapshot()
                    node = next(node for run in state['runs'] if run['id'] == accepted.json()['data']['run_id'] for node in run['nodes'])
                    if node['status'] == 'succeeded':
                        return preview, state['current_outputs'][card][0]
                    assert node['status'] not in ('failed', 'cancelled'), node
                    # Advance scheduling only through TaskWorker's public tick.
                    await asyncio.sleep(.2)
                pytest.fail(str(state))
            text_preview, text = await run('m')
            assert text['text'] == 'A red boat on a quiet lake'
            assert prompts == [text_preview['input']['text']]
            runtime.document['cards'].append({'id': 'image', 'type': 'model.image', 'model_id': runtime.model_id + '-image', 'config': {'count': 1, 'target_ratio': '1:1', 'resolution_profile': 'standard'}, 'prompt': {'segments': [reference('m', 'text')]}})
            runtime.document['edges'].append({'id': 'text-image', 'source_card': 'm', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'})
            runtime.document['input_order']['image'] = {'text': ['text-image']}
            await save('add-image-after-text')
            image_preview, image = await run('image')
            assert json.loads(calls[0].content)['prompt'] == image_preview['input']['text'] == text['text']
            assert image['file_id']
            runtime.document['cards'].append({'id': 'video', 'type': 'model.video', 'model_id': runtime.model_id + '-video', 'config': {'ratio': '16:9', 'seconds': 5}, 'prompt': {'segments': [{'id': 'frame', 'kind': 'instruction', 'command': '首帧参考', 'parameters': {}, 'references': [reference('image', 'image')]}]}})
            runtime.document['edges'].append({'id': 'image-video', 'source_card': 'image', 'source_port': 'image', 'target_card': 'video', 'target_port': 'first_frame'})
            runtime.document['input_order']['video'] = {'first_frame': ['image-video']}
            await save('add-video-after-image')
            video_preview, video = await run('video')
            assert video_preview['input']['video_media']['frames']['first']['file_id'] == image['file_id']
            body = json.loads(next(call for call in calls if call.url.host == 'video.test' and call.method == 'POST').content)
            assert body['content'] == [{'type': 'image_url', 'role': 'first_frame', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(b'generated-boat-image').decode()}}]
            assert video['file_id'] and len([call for call in calls if call.method == 'POST']) == 2
        finally:
            worker.text_pool.shutdown(wait=False)
            # Remove this journey's extra catalog entries after its runtime/Task FKs.
            from sqlalchemy import delete
            from app.models.task import Task
            from app.services.generation_canvas.runtime import delete_runtime
            async with runtime.sessions.begin() as db:
                await delete_runtime(db, runtime.canvas_id)
                await db.execute(delete(Task).where(Task.project_id == runtime.project_id))
                await db.execute(delete(Model).where(Model.id.in_([runtime.model_id + '-image', runtime.model_id + '-video'])))
                await db.execute(delete(Provider).where(Provider.id == runtime.provider_id + '-video'))
