"""Mixed pipelines observed through HTTP and the actual TaskWorker."""
import base64
from copy import deepcopy
import json
import httpx
import pytest
from app.models.llm import Model, Provider
from app.task_worker import TaskWorker
from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401
from tests.test_generation_canvas_dag import save, run, drain


@pytest.mark.asyncio
async def test_fixed_model_image_and_named_performance_run_only_adopted_video(runtime, image_storage):
    async with runtime.sessions.begin() as db:
        db.add(Provider(id='video-provider', name='volcengine', api_key='test', base_url='https://video.test/v1'))
        await db.flush()
        db.add(Model(id='video-model', name='doubao-seedance', category='video', provider_id='video-provider'))
        model = await db.get(Model, runtime.model_id)
        model.category, model.name = 'image', 'image-model'
    doc = deepcopy(runtime.document)
    doc['cards'] = [{'id': 'image', 'type': 'model.image', 'model_id': runtime.model_id,
        'config': {'count': 1}, 'prompt': {'segments': [{'id': 'p', 'kind': 'text', 'text': 'portrait'}]}}]
    await save(runtime, doc)
    calls = []
    def provider(request):
        calls.append((request.method, str(request.url), json.loads(request.content) if request.content else None))
        if request.url.host == 'frozen.test':
            image = b'portrait' if json.loads(request.content)['prompt'] == 'portrait' else b'new-portrait'
            return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(image).decode()}]})
        if request.method == 'POST':
            return httpx.Response(200, json={'id': 'remote-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=b'video', headers={'Content-Type': 'video/mp4'})
        return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://media.test/video.mp4'}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await run(runtime, 'image')
        await drain(worker)
        output = (await runtime.client.get(runtime.url + '/cards/image/outputs')).json()['data']['outputs'][0]
        def source(card, port, **extra):
            return {'canvas_id': runtime.canvas_id, 'card_id': card, 'port_id': port, 'position': 0, **extra}
        def edge(id, src, port, dst, target):
            return {'id': id, 'source_card': src, 'source_port': port, 'target_card': dst, 'target_port': target}
        doc['cards'] += [
            {'id': 'person', 'type': 'content.object', 'object_id': 'alice', 'name': '小雪', 'text': '年龄二十岁'},
            {'id': 'ref', 'type': 'reference.character', 'image_binding': {key: output[key] for key in ('source', 'file_id', 'result_set_id')},
             'input_bindings': [{'id': 'name', 'input_port': 'name', 'source': source('person', 'object', object_id='alice')}]},
            {'id': 'act', 'type': 'direction.performance', 'physical_action': {'text': '伸手拿钥匙', 'state': 'fact'},
             'input_bindings': [{'id': 'actor', 'input_port': 'participant', 'source': source('ref', 'object', object_id='alice')}]},
            {'id': 'video', 'type': 'model.video', 'model_id': 'video-model', 'config': {'ratio': '16:9', 'seconds': 5},
             'input_bindings': [{'id': 'design', 'input_port': 'text', 'source': source('act', 'text')},
                                {'id': 'frame', 'input_port': 'first_frame', 'source': source('ref', 'image')}]},
            {'id': 'candidate', 'type': 'model.text'}]
        doc['edges'] = [edge('image-ref', 'image', 'image', 'ref', 'image_source'), edge('name', 'person', 'object', 'ref', 'name'),
            edge('actor', 'ref', 'object', 'act', 'participant'), edge('design', 'act', 'text', 'video', 'text'),
            edge('frame', 'ref', 'image', 'video', 'first_frame'), edge('unused', 'candidate', 'text', 'video', 'text')]
        doc['input_order'] = {'ref': {'image_source': ['image-ref'], 'name': ['name']}, 'act': {'participant': ['actor']},
                              'video': {'text': ['design', 'unused'], 'first_frame': ['frame']}}
        doc['cards'][0]['prompt']['segments'][0]['text'] = 'new portrait'
        await save(runtime, doc)
        calls.clear()
        accepted, preview = await run(runtime, 'video')
        assert preview['execution_nodes'] == ['video']
        assert len(accepted['task_ids']) == 1
        doc['cards'][1]['text'] = '年龄八十岁'
        await save(runtime, doc)
        await drain(worker)
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        assert state['current_outputs']['video'][0]['basis_current']
        posts = [body for method, _, body in calls if method == 'POST']
        assert len(posts) == 1
        text = posts[0]['content'][0]['text']
        assert '伸手拿钥匙' in text and '小雪' in text
        assert '年龄' not in text and 'portrait' not in text
        assert (await runtime.client.get(runtime.url + '/cards/ref/outputs')).json()['data']['outputs'][0]['file_id'] == output['file_id']
        # Re-running the fixed source publishes another file without changing the
        # adopted reference or its consumer's basis.
        await run(runtime, 'image')
        await drain(worker)
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        assert state['current_outputs']['image'][0]['file_id'] != output['file_id']
        assert state['current_outputs']['video'][0]['basis_current']
        assert sum(node['card_id'] == 'video' for entry in state['runs'] for node in entry['nodes']) == 1
        # Candidate aliases may renumber without adding any input to the request.
        doc['cards'].append({'id': 'noise', 'type': 'content.text', 'text': 'unadopted candidate'})
        doc['edges'].append(edge('noise', 'noise', 'text', 'video', 'text'))
        doc['input_order']['video']['text'] = ['noise', 'unused', 'design']
        await save(runtime, doc)
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        assert state['current_outputs']['video'][0]['basis_current']
        doc['cards'][1]['name'] = '新名字'
        await save(runtime, doc)
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        assert not state['current_outputs']['video'][0]['basis_current']
        # A separately adopted current output creates a real dependency, while
        # the fixed reference continues to use its original file.
        doc['cards'][4]['input_bindings'].append({'id': 'current', 'input_port': 'key_frame', 'source': source('image', 'image')})
        doc['edges'].append(edge('current', 'image', 'image', 'video', 'key_frame'))
        doc['input_order']['video']['key_frame'] = ['current']
        doc['cards'][0]['prompt']['segments'][0]['text'] = 'planned portrait'
        await save(runtime, doc)
        outside = (await runtime.client.post(runtime.url + '/precheck', json={
            'card_id': 'video', 'kind': 'single'})).json()['data']
        assert not outside['can_run'] and any(item['code'] == 'INPUT_STALE' for item in outside['diagnostics'])
        # Explicitly refresh the source, then separately admit the consumer.
        await run(runtime, 'image')
        await drain(worker)
        accepted, preview = await run(runtime, 'video')
        assert preview['execution_nodes'] == ['video']
        assert len(accepted['task_ids']) == 1
        # Accepted requests retain old identity and design even while current edits change.
        doc['cards'][1]['name'] = '再改名字'
        doc['cards'][3]['physical_action']['text'] = '转身离开'
        doc['cards'][0]['prompt']['segments'][0]['text'] = 'third edit'
        await save(runtime, doc)
        calls.clear()
        await drain(worker)
        video_post = next(body for method, url, body in calls if method == 'POST' and 'video.test' in url)
        assert '新名字' in video_post['content'][0]['text']
        assert '再改名字' not in video_post['content'][0]['text']
        assert '伸手拿钥匙' in video_post['content'][0]['text'] and '转身离开' not in video_post['content'][0]['text']
        assert 'cG9ydHJhaXQ=' in str(video_post)  # original fixed portrait bytes
        assert 'bmV3LXBvcnRyYWl0' in str(video_post)  # explicitly refreshed current output
        reopened = (await runtime.client.get(runtime.url)).json()['data']['document']
        assert reopened['cards'][2]['image_binding']['file_id'] == output['file_id']
        # Adopted fixed sources must be explicitly copied and rebound before deletion.
        deletion = deepcopy(doc)
        deletion['cards'] = deletion['cards'][1:]
        deletion['edges'] = [item for item in deletion['edges'] if item['id'] not in ('image-ref', 'current')]
        del deletion['input_order']['ref']['image_source']
        del deletion['input_order']['video']['key_frame']
        deletion['cards'][3]['input_bindings'] = [item for item in deletion['cards'][3]['input_bindings'] if item['id'] != 'current']
        current = (await runtime.client.get(runtime.url)).json()['data']
        rejected = await runtime.client.put(runtime.url, json={'request_id': 'unsafe-delete',
            'expected_revision': current['revision'], 'document': deletion})
        assert rejected.status_code == 422 and rejected.json()['detail']['code'] == 'REFERENCE_IN_USE'
        history = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['runs']
        original = next(node for entry in history for node in entry['nodes'] if node['card_id'] == 'image' and node['outputs'][0]['file_id'] == output['file_id'])
        original_run = next(entry for entry in history if any(node['id'] == original['id'] for node in entry['nodes']))
        copied = (await runtime.client.get(runtime.url + f"/runs/{original_run['id']}/nodes/{original['id']}/outputs/0/content")).json()['data']
        deletion['cards'].append(copied)
        deletion['cards'][1]['image_binding'] = {'file_id': output['file_id'], 'source': source(copied['id'], 'image')}
        deletion['edges'].append(edge('copy-ref', copied['id'], 'image', 'ref', 'image_source'))
        deletion['input_order']['ref']['image_source'] = ['copy-ref']
        await save(runtime, deletion)
        assert (await runtime.client.get(runtime.url + f"/runs/{original_run['id']}/nodes/{original['id']}/outputs/0/content")).status_code == 200
        worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_withdrawn_current_model_media_keeps_identity_and_blocks_single_admission(runtime, image_storage):
    from app.models.studio import FileItem
    from app.services.task_service import utcnow
    from tests.test_generation_canvas_images import image_card
    await image_card(runtime, count=1)
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200,
            json={'data': [{'b64_json': base64.b64encode(b'first').decode()}]}))) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await run(runtime, 'image')
        await drain(worker)
        worker.text_pool.shutdown(wait=False)
    output = (await runtime.client.get(runtime.url + '/cards/image/outputs')).json()['data']['outputs'][0]
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    doc['cards'].append({'id': 'consumer', 'type': 'model.image', 'model_id': runtime.model_id,
        'prompt': {'segments': [{'id': 'p', 'kind': 'text', 'text': 'use this'}]},
        'input_bindings': [{'id': 'input', 'input_port': 'image', 'source': output['source']}]})
    doc['edges'] = [{'id': 'e', 'source_card': 'image', 'source_port': 'image', 'target_card': 'consumer', 'target_port': 'image'}]
    doc['input_order'] = {'consumer': {'image': ['e']}}
    await save(runtime, doc)
    # External file withdrawal can occur after publication; it is never a promise to rerun.
    async with runtime.sessions.begin() as db:
        file = await db.get(FileItem, output['file_id'])
        file.delete_requested_at = utcnow()
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer', 'kind': 'single'})).json()['data']
    assert not preview['can_run']
    assert any(item['code'] == 'OUTPUT_MISSING' for item in preview['diagnostics'])
    assert preview['execution_nodes'] == ['consumer']
    outputs = (await runtime.client.get(runtime.url + '/cards/image/outputs')).json()['data']['outputs']
    assert outputs[0]['source'] == output['source'] and not outputs[0]['available']
    assert (await runtime.client.get(runtime.url)).json()['data']['document']['cards'][-1]['input_bindings'][0]['source'] == output['source']
