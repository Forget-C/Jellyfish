"""公开接口与真实 worker 保留审查发现的回归覆盖。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store

@pytest.mark.asyncio
async def test_reference_aware_frame_target_is_available(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': 'review'})).json()['data']
    doc = canvas['document']
    url = '/canvases/p/' + canvas['id']
    source = lambda card, port: {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0}
    doc.update(cards=[{'id': 'brief', 'type': 'content.text', 'text': '站在窗边'}, {'id': 'move', 'type': 'direction.movement', 'phases': [{'id': 'end', 'name': '落幅', 'frame': {'state': 'proposal', 'document': {'segments': [{'id': 'ref', 'kind': 'reference', 'source': source('brief', 'text')}]}}}]}, {'id': 'composition', 'type': 'direction.composition', 'fields': {'composition': {'state': 'proposal', 'text': '左侧构图'}}, 'frame_target': {'card_id': 'move', 'state_id': 'phase:end'}}, {'id': 'model', 'type': 'model.image', 'model_id': 'canvas-image', 'input_bindings': [{'id': 'use', 'input_port': 'text', 'source': source('composition', 'text')}]}], edges=[{'id': 'text', 'source_card': 'brief', 'source_port': 'text', 'target_card': 'move', 'target_port': 'text'}, {'id': 'design', 'source_card': 'composition', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'move': {'text': ['text']}, 'model': {'text': ['design']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    movement = (await client.get(url + '/cards/move/outputs')).json()['data']['outputs'][0]['payload']
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert movement['frame_states'] == [{'id': 'phase:end', 'label': '落幅'}]
    print('reference-aware phase published:', movement['frame_states'], 'target:', compiled['used'][0]['payload']['frame_target_state'], 'diagnostics:', compiled['diagnostics'])
    assert 'DESIGN_FRAME_TARGET_MISSING' not in {x['code'] for x in compiled['diagnostics']}

@pytest.mark.asyncio
async def test_composition_keeps_declared_object_relationship(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': 'review'})).json()['data']
    url = '/canvases/p/' + canvas['id']
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'person', 'port_id': 'object', 'position': 0, 'object_id': 'person-id'}
    doc.update(cards=[{'id': 'person', 'type': 'content.character', 'object_id': 'person-id', 'name': '张三', 'text': '人物'}, {'id': 'composition', 'type': 'direction.composition', 'fields': {'composition': {'state': 'proposal', 'text': '左侧构图'}}, 'input_bindings': [{'id': 'obj', 'input_port': 'effect_object', 'source': source}]}], edges=[{'id': 'obj', 'source_card': 'person', 'source_port': 'object', 'target_card': 'composition', 'target_port': 'effect_object'}], input_order={'composition': {'effect_object': ['obj']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    payload = (await client.get(url + '/cards/composition/outputs')).json()['data']['outputs'][0]['payload']
    print('composition object relation:', payload)
    assert payload['objects'] and payload['objects'][0]['name'] == '张三'

@pytest.mark.asyncio
async def test_target_document_change_invalidates_actual_basis(runtime, image_storage):
    import asyncio, httpx
    from app.task_worker import TaskWorker
    from tests.test_generation_canvas_images import image_card, accept
    await image_card(runtime, count=1)
    doc = runtime.document
    source = {'canvas_id': runtime.canvas_id, 'card_id': 'composition', 'port_id': 'text', 'position': 0}
    doc['cards'] = [{'id': 'move', 'type': 'direction.movement', 'phases': [{'id': 'end', 'name': '落幅', 'frame': {'text': '缓存', 'state': 'proposal', 'document': {'segments': [{'id': 't', 'kind': 'text', 'text': '真实画面A'}]}}}]}, {'id': 'composition', 'type': 'direction.composition', 'fields': {'composition': {'state': 'proposal', 'text': '构图'}}, 'frame_target': {'card_id': 'move', 'state_id': 'phase:end'}}, {**doc['cards'][0], 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text'}]}]
    doc['edges'] = [{'id': 'e', 'source_card': 'composition', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}]
    doc['input_order'] = {'image': {'text': ['e']}}
    saved = await runtime.client.put(runtime.url, json={'request_id': 'setup', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    await accept(runtime)

    def provider(_request):
        return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    doc['cards'][0]['phases'][0]['frame']['document']['segments'][0]['text'] = '真实画面B'
    saved = await runtime.client.put(runtime.url, json={'request_id': 'changed', 'expected_revision': 3, 'document': doc})
    assert saved.status_code == 200, saved.text
    movement = (await runtime.client.get(runtime.url + '/cards/move/outputs')).json()['data']['outputs'][0]['text']
    current = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['current_outputs']['image'][0]['basis_current']
    print('new actual phase:', movement, 'consumer basis_current:', current)
    assert not current
    doc['cards'][0]['phases'][0]['frame']['document']['segments'][0].update(id='renamed-fragment', text='真实画面A')
    doc['cards'][0]['phases'][0]['name'] = '仅改显示名'
    saved = await runtime.client.put(runtime.url, json={'request_id': 'semantic-restore', 'expected_revision': 4, 'document': doc})
    assert saved.status_code == 200, saved.text
    restored = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['current_outputs']['image'][0]
    assert not restored['basis_current'], '完整运镜正文的阶段名称已变化'
from tests.test_generation_canvas_runs import runtime
from tests.test_generation_canvas_images import image_storage


@pytest.mark.asyncio
async def test_target_only_model_reference_freezes_without_adopting_movement(runtime, image_storage, monkeypatch):
    import asyncio
    import httpx
    import json
    from types import SimpleNamespace
    from app.models.llm import Model
    from app.task_worker import TaskWorker
    from tests.test_generation_canvas_runs import accept as accept_text
    class TextModel:
        def __init__(self, **_kwargs):
            pass
        async def astream(self, _messages):
            yield SimpleNamespace(content='目标画面人物站窗边')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', TextModel)
    await accept_text(runtime)
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    worker.text_pool.shutdown(wait=False)
    async with runtime.sessions.begin() as db:
        db.add(Model(id='image-' + runtime.model_id, name='image-model', category='image', provider_id=runtime.provider_id))
    source = lambda card: {'canvas_id': runtime.canvas_id, 'card_id': card, 'port_id': 'text', 'position': 0}
    doc = runtime.document
    doc['cards'] += [
        {'id': 'move', 'type': 'direction.movement', 'fields': {'movement_path': {'state': 'fact', 'text': '不能自动采用的运镜正文'}},
         'phases': [{'id': 'end', 'name': '落幅', 'frame': {'state': 'proposal', 'document': {'segments': [{'id': 'ref', 'kind': 'reference', 'source': source('m')}]}}}]},
        {'id': 'composition', 'type': 'direction.composition', 'fields': {'composition': {'state': 'proposal', 'text': '左侧构图'}}, 'frame_target': {'card_id': 'move', 'state_id': 'phase:end'}},
        {'id': 'image', 'type': 'model.image', 'model_id': 'image-' + runtime.model_id, 'config': {'count': 1}, 'input_bindings': [{'id': 'use', 'source': source('composition'), 'input_port': 'text'}]}]
    doc['edges'] = [{'id': 'ref', 'source_card': 'm', 'source_port': 'text', 'target_card': 'move', 'target_port': 'text'},
        {'id': 'design', 'source_card': 'composition', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}]
    doc['input_order'] = {'move': {'text': ['ref']}, 'image': {'text': ['design']}}
    saved = await runtime.client.put(runtime.url, json={'request_id': 'target', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'image'})).json()['data']
    assert preview['can_run'], preview
    assert preview['input']['media'] == []
    assert '目标画面人物站窗边' in preview['input']['text'] and '不能自动采用' in preview['input']['text']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'image', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    doc['cards'][0]['prompt']['segments'][0]['text'] = '运行后的新文本'
    doc['cards'][1]['phases'][0]['frame']['document']['segments'] = [{'id': 'later', 'kind': 'text', 'text': '运行后修改目标'}]
    assert (await runtime.client.put(runtime.url, json={'request_id': 'later', 'expected_revision': 2, 'document': doc})).status_code == 200
    calls = []
    def provider(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1, 'target-only model output must be available in the accepted snapshot'
    assert calls[0]['prompt'] == preview['input']['text']
