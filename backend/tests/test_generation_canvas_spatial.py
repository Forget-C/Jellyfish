"""空间设计通过公开 HTTP 保存、输出和编译。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401



@pytest.mark.asyncio
async def test_text_anchor_and_blocking_keep_identity_and_do_not_read_ancestors(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '空间'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    def source(card, port, **extra):
        return {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0, **extra}
    doc = canvas['document']
    doc.update(cards=[{'id': 'place', 'type': 'content.place', 'object_id': 'hall', 'name': '大厅', 'text': '不应穿透的场所正文'},
        {'id': 'anchor', 'type': 'direction.anchor', 'anchor_id': 'door', 'name': '门边', 'position': {'state': 'fact', 'text': '东墙'},
         'input_bindings': [{'id': 'space', 'input_port': 'space', 'source': source('place', 'object', object_id='hall')}]},
        {'id': 'blocking', 'type': 'direction.blocking', 'blocking_id': 'cross', 'name': '穿过大厅', 'path': {'state': 'proposal', 'text': '从门边走向窗前'},
         'input_bindings': [{'id': 'position', 'input_port': 'position_anchor', 'source': source('anchor', 'anchor', object_id='door')}]},
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'design', 'input_port': 'text', 'source': source('blocking', 'text')}]}],
        edges=[{'id': 'a', 'source_card': 'place', 'source_port': 'object', 'target_card': 'anchor', 'target_port': 'space'},
               {'id': 'b', 'source_card': 'anchor', 'source_port': 'anchor', 'target_card': 'blocking', 'target_port': 'position_anchor'},
               {'id': 'c', 'source_card': 'blocking', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'anchor': {'space': ['a']}, 'blocking': {'position_anchor': ['b']}, 'model': {'text': ['c']}})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    outputs = (await client.get(url + '/cards/anchor/outputs')).json()['data']['outputs']
    assert outputs[1]['payload']['reference_id'] == 'door'
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert '从门边走向窗前' in compiled['text'] and '门边' in compiled['text']
    assert '不应穿透' not in compiled['text'] and '东墙' not in compiled['text']
    assert not compiled['media']
    blocking_output = (await client.get(url + '/cards/blocking/outputs')).json()['data']['outputs'][0]
    assert blocking_output['payload']['spatial_relations']['position_anchor_ids'] == ['door']
    reopened = (await client.get(url)).json()['data']['document']
    assert reopened['cards'][2]['blocking_id'] == 'cross'


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,fields', [
    ('activity', {'task': '搬运', 'attention': '留意门口', 'main_action_effect': '衬托主戏', 'path': '沿东墙', 'delay_basis': '听完再动', 'entry_exit': '左入右出', 'exit_state': '停在窗前', 'depth': '后景', 'intensity': '低'}),
    ('environment', {'activity': '窗帘轻动', 'empty_space': '门口无人', 'reason': '保持压迫感'}),
])
async def test_independent_activity_and_environment_keep_complete_fields(canvas_client, kind, fields):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '活动'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    card = {'id': 'design', 'type': 'direction.' + kind, **{key: {'state': 'proposal', 'text': value} for key, value in fields.items()}}
    if kind == 'activity':
        card['delay_ms'] = 350
    doc = canvas['document']
    doc['cards'] = [card]
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    outputs = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs']
    assert len(outputs) == 1 and outputs[0]['payload']['adoption'] == 'whole_card'
    for key, value in fields.items():
        assert outputs[0]['payload']['fields'][key]['text'] == value
        assert value in outputs[0]['text']
    if kind == 'activity':
        assert outputs[0]['payload']['fields']['delay_ms'] == 350 and '350' in outputs[0]['text']
    assert (await client.get(url)).json()['data']['document']['cards'][0]['type'] == 'direction.' + kind


@pytest.mark.asyncio
async def test_anchor_reference_replacement_keeps_identity_marker_and_fixed_file(canvas_client):
    client = canvas_client
    files = [(await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': (f'{i}.png', b'image', 'image/png')})).json()['data']['id'] for i in range(2)]
    canvas = (await client.post('/canvases/p', json={'name': '标记'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}
    doc.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': files[0]},
        {'id': 'anchor', 'type': 'direction.anchor', 'anchor_id': 'door', 'name': '门',
         'examples': [{'id': 'ex', 'file_id': files[0], 'source': source}], 'markers': [{'example_id': 'ex', 'x': 0.25, 'y': 0.75}]}],
        edges=[{'id': 'e', 'source_card': 'image', 'source_port': 'image', 'target_card': 'anchor', 'target_port': 'image_example'}], input_order={'anchor': {'image_example': ['e']}})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    doc['cards'][0]['file_id'] = files[1]
    assert (await client.put(url, json={'request_id': 'replace-source', 'expected_revision': 1, 'document': doc})).status_code == 200
    reopened = (await client.get(url)).json()['data']['document']['cards'][1]
    assert reopened['anchor_id'] == 'door' and reopened['examples'][0]['file_id'] == files[0]
    assert reopened['markers'][0] == {'example_id': 'ex', 'x': 0.25, 'y': 0.75}
    outputs = (await client.get(url + '/cards/anchor/outputs')).json()['data']['outputs']
    assert files[0] not in str(outputs) and files[1] not in str(outputs)
    doc['cards'][1]['examples'][0]['file_id'] = files[1]
    assert (await client.put(url, json={'request_id': 'replace-reference', 'expected_revision': 2, 'document': doc})).status_code == 200
    assert (await client.get(url + '/cards/anchor/outputs')).json()['data']['outputs'][1]['payload']['reference_id'] == 'door'
    doc['cards'] = doc['cards'][1:]
    doc.update(edges=[], input_order={})
    response = await client.put(url, json={'request_id': 'delete', 'expected_revision': 3, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'REFERENCE_IN_USE'


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,port,category,count,code', [
    ('anchor', 'space', 'character', 1, 'INVALID_SPATIAL_CATEGORY'),
    ('anchor', 'space', 'place', 2, 'SPATIAL_RELATION_COUNT'),
    ('activity', 'participant', 'place', 1, 'INVALID_SPATIAL_CATEGORY'),
    ('blocking', 'participant', 'character', 2, 'SPATIAL_RELATION_COUNT'),
    ('blocking', 'participant', 'costume', 1, None),
])
async def test_spatial_relations_use_specific_direct_eligible_objects(canvas_client, kind, port, category, count, code):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '关系'})).json()['data']
    doc = canvas['document']
    objects = [{'id': f'object{i}', 'type': 'content.place' if category == 'place' else 'content.object', 'object_id': f'identity{i}', 'name': f'对象{i}', 'category': category} for i in range(count)]
    bindings = [{'id': str(i), 'input_port': port, 'source': {'canvas_id': canvas['id'], 'card_id': f'object{i}', 'port_id': 'object', 'object_id': f'identity{i}', 'position': 0}} for i in range(count)]
    doc.update(cards=[*objects, {'id': 'design', 'type': 'direction.' + kind, 'input_bindings': bindings}],
        edges=[{'id': str(i), 'source_card': f'object{i}', 'source_port': 'object', 'target_card': 'design', 'target_port': port} for i in range(count)],
        input_order={'design': {port: [str(i) for i in range(count)]}})
    response = await client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == (422 if code else 200), response.text
    if code:
        assert response.json()['detail']['code'] == code


from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401

@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['text', 'video'])
async def test_actual_worker_receives_complete_spatial_design_without_ancestor(runtime, image_storage, monkeypatch, modality):
    import asyncio
    import json
    from types import SimpleNamespace
    import httpx
    from app.models.llm import Model, Provider
    from app.task_worker import TaskWorker
    from app.services.task_service import utcnow
    from datetime import timedelta
    async with runtime.sessions.begin() as db:
        if modality == 'video':
            model = await db.get(Model, runtime.model_id)
            model.name, model.category, model.params = 'doubao-seedance', 'video', {}
            provider = await db.get(Provider, runtime.provider_id)
            provider.name = 'volcengine'
    source = lambda card, port, **extra: {'canvas_id': runtime.canvas_id, 'card_id': card, 'port_id': port, 'position': 0, **extra}
    doc = runtime.document
    doc.update(cards=[{'id': 'person', 'type': 'content.object', 'object_id': 'alice', 'name': '小雪', 'text': '秘密外貌描述'},
                     {'id': 'act', 'type': 'direction.activity', 'task': {'state': 'proposal', 'text': '伸手'}, 'exit_state': {'state': 'fact', 'text': '看向门口'},
                      'input_bindings': [{'id': 'p', 'source': source('person', 'object', object_id='alice'), 'input_port': 'participant'}]},
                     {'id': 'consumer', 'type': 'model.' + modality, 'model_id': runtime.model_id, 'config': {'ratio': '16:9', 'seconds': 5} if modality == 'video' else {},
                      'input_bindings': [{'id': 'whole', 'source': source('act', 'text'), 'input_port': 'text'}]}],
               edges=[{'id': 'p', 'source_card': 'person', 'source_port': 'object', 'target_card': 'act', 'target_port': 'participant'}, {'id': 'd', 'source_card': 'act', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}],
               input_order={'act': {'participant': ['p']}, 'consumer': {'text': ['d']}})
    saved = await runtime.client.put(runtime.url, json={'request_id': 'direction', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'], preview
    assert not preview['input']['media'] and '秘密外貌描述' not in preview['input']['text']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'run', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200
    received = []
    class ProviderText:
        def __init__(self, **kwargs):
            pass
        async def astream(self, messages):
            received.append(messages[0].content)
            yield SimpleNamespace(content='完整空间分析')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', ProviderText)
    def provider_http(request):
        if request.method == 'POST':
            body = json.loads(request.content)
            received.append(body['content'][0]['text'])
            return httpx.Response(200, json={'id': 'performance-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=b'whole-performance-video', headers={'Content-Type': 'video/mp4'})
        return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://media.test/video.mp4'}})
    clock = [utcnow()]
    monkeypatch.setattr('app.task_worker.utcnow', lambda: clock[0])
    monkeypatch.setattr('app.services.task_service.utcnow', lambda: clock[0])
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider_http)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        for _ in range(3):
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            await asyncio.sleep(0)
            clock[0] += timedelta(seconds=10)
        worker.text_pool.shutdown(wait=False)
    assert received == [preview['input']['text']]
    assert '伸手' in received[0] and '看向门口' in received[0] and '小雪' in received[0]
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] == 'succeeded', node
    assert node['result_set_id'] and node['current_output_updated']


@pytest.mark.asyncio
async def test_anchor_identity_cannot_be_silently_reassigned(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '身份'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc['cards'] = [{'id': 'anchor', 'type': 'direction.anchor', 'anchor_id': 'door', 'name': '门'}]
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    doc['cards'][0]['anchor_id'] = 'window'
    response = await client.put(url, json={'request_id': 'change', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'IMMUTABLE_SPATIAL_IDENTITY'


@pytest.mark.asyncio
async def test_spatial_candidate_graph_cannot_cycle(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '无环'})).json()['data']
    doc = canvas['document']
    doc.update(cards=[{'id': 'anchor', 'type': 'direction.anchor'}, {'id': 'model', 'type': 'model.image'}],
        edges=[{'id': 'a', 'source_card': 'anchor', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}, {'id': 'b', 'source_card': 'model', 'source_port': 'image', 'target_card': 'anchor', 'target_port': 'image_example'}],
        input_order={'model': {'text': ['a']}, 'anchor': {'image_example': ['b']}})
    response = await canvas_client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'GRAPH_CYCLE'


@pytest.mark.asyncio
@pytest.mark.parametrize('port,start,end', [('image', 0, 10), ('video', 10, 10), ('video', 20, 10), ('video', -1, 10), ('video', None, 10)])
async def test_spatial_media_rejects_invalid_intervals(canvas_client, port, start, end):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '区间'})).json()['data']
    doc = canvas['document']
    doc['cards'] = [{'id': 'anchor', 'type': 'direction.anchor', 'examples': [{'id': 'media', 'file_id': 'file', 'source': {'canvas_id': canvas['id'], 'card_id': 'source', 'port_id': port, 'position': 0}, 'start_ms': start, 'end_ms': end}]}]
    response = await canvas_client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'INVALID_DOCUMENT'


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,field', [('blocking', 'path'), ('activity', 'task')])
async def test_visual_spatial_action_requires_explicit_participant_but_text_can_analyze(canvas_client, kind, field):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '主体'})).json()['data']
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'design', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'design', 'type': 'direction.' + kind, field: {'state': 'proposal', 'text': '走到门口'}},
        *[{'id': model, 'type': 'model.' + model, 'input_bindings': [{'id': 'design', 'input_port': 'text', 'source': source}]} for model in ('text', 'video')]],
        edges=[{'id': model, 'source_card': 'design', 'source_port': 'text', 'target_card': model, 'target_port': 'text'} for model in ('text', 'video')],
        input_order={model: {'text': [model]} for model in ('text', 'video')})
    url = f"/canvases/p/{canvas['id']}"
    assert (await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    for model in ('text', 'video'):
        compiled = (await canvas_client.get(url + f'/cards/{model}/compile')).json()['data']
        assert ('DESIGN_SUBJECT_REQUIRED' in [row['code'] for row in compiled['diagnostics']]) == (model == 'video')
