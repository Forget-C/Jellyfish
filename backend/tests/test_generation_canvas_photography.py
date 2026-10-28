"""摄影选择通过公开保存与编译边界验证。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_photography_adoption_projects_only_declared_movement_range(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '摄影'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'photo', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'photo', 'type': 'direction.photography', 'fields': {'movement_path': {'text': '绕行半圈', 'state': 'proposal'}}},
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text', 'photography_scope': ['region:movement']}]}],
        edges=[{'id': 'e', 'source_card': 'photo', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['e']}})
    saved = await client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    first = (await client.get(url + '/cards/model/compile')).json()['data']
    assert '绕行半圈' in first['text']
    doc['cards'][0]['fields']['light_sources'] = {'text': '红色侧光', 'state': 'fact'}
    assert (await client.put(url, json={'request_id': 'light', 'expected_revision': 1, 'document': doc})).status_code == 200
    second = (await client.get(url + '/cards/model/compile')).json()['data']
    assert first["text"] == second["text"]
    assert first["used"] == second["used"]
    outputs = (await client.get(url + '/cards/photo/outputs')).json()['data']['outputs']
    assert '红色侧光' in outputs[0]['text']
    assert 'region:movement' in [scope['id'] for scope in outputs[0]['payload']['adoption_scopes']]


@pytest.mark.asyncio
async def test_image_requires_explicit_structured_frame_target_without_cutting_design(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '目标'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'photo', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'photo', 'type': 'direction.photography', 'fields': {
        'movement_start': {'text': '门外全景', 'state': 'proposal'}, 'end_frame': {'text': '窗边特写', 'state': 'fact'}, 'movement_path': {'text': '自由描述先推后拉', 'state': 'proposal'}}},
        {'id': 'image', 'type': 'model.image', 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text'}]}],
        edges=[{'id': 'e', 'source_card': 'photo', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}], input_order={'image': {'text': ['e']}})
    assert (await client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})).status_code == 200
    before = (await client.get(url + '/cards/image/compile')).json()['data']
    assert 'FRAME_TARGET_REQUIRED' in [item['code'] for item in before['diagnostics']]
    doc['cards'][1]['frame_targets'] = [{'binding_id': 'use', 'state_id': 'field:end_frame'}]
    assert (await client.put(url, json={'request_id': 'target', 'expected_revision': 1, 'document': doc})).status_code == 200
    after = (await client.get(url + '/cards/image/compile')).json()['data']
    assert 'FRAME_TARGET_REQUIRED' not in [item['code'] for item in after['diagnostics']]
    assert '画面目标：结束画面' in after['text']
    assert '门外全景' in after['text'] and '窗边特写' in after['text'] and '自由描述先推后拉' in after['text']
    assert before['used'] == after['used']


@pytest.mark.asyncio
async def test_known_hard_framing_conflict_requires_same_explicit_target_and_state(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '硬要求'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    def photo(ident, size, state='fact', target='frame1'):
        return {'id': ident, 'type': 'direction.photography', 'fields': {'shot_size': {'text': size, 'size': size, 'target_id': target, 'state': state, 'purpose': 'constraint'}}}
    def src(ident):
        return {'canvas_id': canvas['id'], 'card_id': ident, 'port_id': 'text', 'position': 0}
    doc.update(cards=[photo('a', 'close_up'), photo('b', 'wide'), {'id': 'model', 'type': 'model.image', 'input_bindings': [{'id': ident, 'source': src(ident), 'input_port': 'text'} for ident in ('a', 'b')]}],
        edges=[{'id': ident, 'source_card': ident, 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'} for ident in ('a', 'b')], input_order={'model': {'text': ['a', 'b']}})
    response = await client.put(url, json={'request_id': 'hard', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'CONFLICTING_FRAME_REQUIREMENTS' in [row['code'] for row in compiled['diagnostics']]
    doc['cards'][1]['fields']['shot_size']['state'] = 'proposal'
    assert (await client.put(url, json={'request_id': 'open', 'expected_revision': 1, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'CONFLICTING_FRAME_REQUIREMENTS' not in [row['code'] for row in compiled['diagnostics']]


@pytest.mark.asyncio
async def test_stable_phase_selection_survives_rename_reorder_clear_but_not_delete(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '稳定范围'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'photo', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'photo', 'type': 'direction.photography', 'phases': [{'id': 'end', 'name': '结束', 'frame': {'state': 'proposal', 'text': '窗边'}}, {'id': 'start', 'name': '起点', 'frame': {'state': 'fact', 'text': '门外'}}]},
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text', 'photography_scope': ['phase:end']}]}],
        edges=[{'id': 'e', 'source_card': 'photo', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['e']}})
    async def save(request, revision):
        response = await client.put(url, json={'request_id': request, 'expected_revision': revision, 'document': doc})
        assert response.status_code == 200, response.text
        return (await client.get(url + '/cards/model/compile')).json()['data']
    assert '窗边' in (await save('first', 0))['text']
    doc['cards'][0]['phases'].reverse()
    doc['cards'][0]['phases'][1]['name'] = '落幅'
    renamed = await save('rename', 1)
    assert '落幅' in renamed['text'] and '门外' not in renamed['text']
    doc['cards'][0]['phases'][1]['frame'] = {'state': 'empty', 'text': ''}
    cleared = await save('clear', 2)
    assert 'PHOTOGRAPHY_SCOPE_MISSING' not in [row['code'] for row in cleared['diagnostics']]
    doc['cards'][0]['phases'].pop()
    deleted = await save('delete', 3)
    assert 'PHOTOGRAPHY_SCOPE_MISSING' in [row['code'] for row in deleted['diagnostics']]
    assert not deleted['used'] and '窗边' not in deleted['text']


@pytest.mark.asyncio
@pytest.mark.parametrize('scope', [['fields.movement_path'], ['field:made_up'], [], ['field:gaze']])
async def test_undeclared_photography_scope_never_becomes_an_arbitrary_path(canvas_client, scope):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '非法范围'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'photo', 'port_id': 'text', 'position': 0}
    doc = canvas['document']
    doc.update(cards=[{'id': 'photo', 'type': 'direction.photography', 'fields': {'movement_path': {'state': 'proposal', 'text': '不会回退全卡'}}}, {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text', 'photography_scope': scope}]}], edges=[{'id': 'e', 'source_card': 'photo', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['e']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'PHOTOGRAPHY_SCOPE_MISSING' in [row['code'] for row in compiled['diagnostics']]
    assert not compiled['used'] and not compiled['text']


@pytest.mark.asyncio
@pytest.mark.parametrize("design_type", ["direction.performance", "direction.activity"])
async def test_performance_existing_exit_state_is_optional_target_with_complete_adoption(canvas_client, design_type):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '完整表演目标'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'performance', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'performance', 'type': design_type, ('physical_action' if design_type == 'direction.performance' else 'task'): {'text': '先举手后坐下', 'state': 'proposal'}, 'exit_state': {'text': '坐在窗边', 'state': 'fact'}}, {'id': 'image', 'type': 'model.image', 'frame_targets': [{'binding_id': 'use', 'state_id': 'field:exit_state'}], 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text'}]}], edges=[{'id': 'e', 'source_card': 'performance', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}], input_order={'image': {'text': ['e']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/image/compile')).json()['data']
    assert 'FRAME_TARGET_MISSING' not in [row['code'] for row in compiled['diagnostics']]
    assert '画面目标：结束状态' in compiled['text'] and '先举手后坐下' in compiled['text'] and '坐在窗边' in compiled['text']
    assert compiled['used'][0]['payload']['adoption'] == 'whole_card'


from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['text', 'image', 'video'])
async def test_real_worker_receives_selected_photography_and_only_selected_changes_stale_results(runtime, image_storage, monkeypatch, modality):
    import asyncio
    import json
    from datetime import timedelta
    from types import SimpleNamespace
    import httpx
    from app.models.llm import Model, Provider
    from app.task_worker import TaskWorker
    from app.services.task_service import utcnow
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        if modality != 'text':
            model.name, model.category, model.params = ('image-model' if modality == 'image' else 'doubao-seedance'), modality, {}
        if modality == 'video':
            provider = await db.get(Provider, runtime.provider_id)
            provider.name = 'volcengine'
    source = {'canvas_id': runtime.canvas_id, 'card_id': 'photo', 'port_id': 'text', 'position': 0}
    doc = runtime.document
    doc.update(cards=[{'id': 'photo', 'type': 'direction.photography', 'fields': {'movement_path': {'state': 'proposal', 'text': '向右平移'}, 'light_sources': {'state': 'fact', 'text': '红色光影不可传入'}}},
        {'id': 'consumer', 'type': 'model.' + modality, 'model_id': runtime.model_id, 'config': {'ratio': '16:9', 'seconds': 5} if modality == 'video' else {'target_ratio': '16:9', 'resolution_profile': 'standard', 'count': 1} if modality == 'image' else {}, 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text', 'photography_scope': ['region:movement']}]}],
        edges=[{'id': 'e', 'source_card': 'photo', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}], input_order={'consumer': {'text': ['e']}})
    saved = await runtime.client.put(runtime.url, json={'request_id': 'photo', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'], preview
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'run-photo', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    received = []
    class TextProvider:
        def __init__(self, **kwargs):
            pass
        async def astream(self, messages):
            received.append(messages[0].content)
            yield SimpleNamespace(content='摄影分析完成')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', TextProvider)
    def provider_http(request):
        if request.method == 'POST':
            body = json.loads(request.content)
            received.append(body['prompt'] if modality == 'image' else body['content'][0]['text'])
            return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]} if modality == 'image' else {'id': 'photo-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=b'photography-video', headers={'Content-Type': 'video/mp4'})
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
    assert '向右平移' in received[0] and '红色光影不可传入' not in received[0]
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['runs'][0]['nodes'][0]['status'] == 'succeeded', state
    assert state['current_outputs']['consumer'][0]['basis_current']
    doc['cards'][0]['fields']['light_sources']['text'] = '新增蓝色光影仍不传入'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'unused-edit', 'expected_revision': 2, 'document': doc})).status_code == 200
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['current_outputs']['consumer'][0]['basis_current']
    doc['cards'][0]['fields']['movement_path']['text'] = '实际采用运镜改变'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'used-edit', 'expected_revision': 3, 'document': doc})).status_code == 200
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert not state['current_outputs']['consumer'][0]['basis_current']


@pytest.mark.asyncio
async def test_structured_framing_is_compiled_even_without_free_text(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '结构景别'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc.update(cards=[{'id': 'photo', 'type': 'direction.photography', 'fields': {'shot_size': {'state': 'fact', 'purpose': 'constraint', 'size': 'close_up', 'target_id': 'frame1'}}}, {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'use', 'input_port': 'text', 'source': {'canvas_id': canvas['id'], 'card_id': 'photo', 'port_id': 'text', 'position': 0}}]}], edges=[{'id': 'e', 'source_card': 'photo', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['e']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert '特写' in compiled['text'] and 'frame1' in compiled['text'] and '约束' in compiled['text'] and '事实' in compiled['text']


@pytest.mark.asyncio
async def test_photography_direct_object_and_located_example_never_expand_ancestors(canvas_client):
    client = canvas_client
    file = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('end.png', b'image', 'image/png')})).json()['data']
    canvas = (await client.post('/canvases/p', json={'name': '摄影关系'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    def source(ident, port, **extra):
        return {'canvas_id': canvas['id'], 'card_id': ident, 'port_id': port, 'position': 0, **extra}
    doc.update(cards=[{'id': 'person', 'type': 'content.object', 'object_id': 'alice', 'name': '小雪', 'text': '不能跨级读取的外貌'}, {'id': 'image', 'type': 'content.image', 'file_id': file['id']},
        {'id': 'photo', 'type': 'direction.photography', 'fields': {'end_frame': {'state': 'proposal', 'text': '窗边落幅'}}, 'input_bindings': [{'id': 'object', 'source': source('person', 'object', object_id='alice'), 'input_port': 'focus_object'}], 'examples': [{'id': 'example', 'source': source('image', 'image'), 'file_id': file['id'], 'field_id': 'end_frame', 'purpose': 'positive'}]},
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'photo', 'source': source('photo', 'text'), 'input_port': 'text'}]}],
        edges=[{'id': 'object', 'source_card': 'person', 'source_port': 'object', 'target_card': 'photo', 'target_port': 'focus_object'}, {'id': 'example', 'source_card': 'image', 'source_port': 'image', 'target_card': 'photo', 'target_port': 'image_example'}, {'id': 'design', 'source_card': 'photo', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'photo': {'focus_object': ['object'], 'image_example': ['example']}, 'model': {'text': ['design']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    output = (await client.get(url + '/cards/photo/outputs')).json()['data']['outputs'][0]
    assert '小雪' in output['text'] and 'alice' in output['text']
    assert '不能跨级' not in str(output) and file['id'] not in str(output)
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert not compiled['media'] and '窗边落幅' in compiled['text']
    assert (await client.delete(f"/files/{file['id']}/upload-retention?project_id=p")).status_code == 409
    doc['cards'] = [card for card in doc['cards'] if card['id'] != 'image']
    doc['edges'] = [edge for edge in doc['edges'] if edge['id'] != 'example']
    del doc['input_order']['photo']['image_example']
    blocked = await client.put(url, json={'request_id': 'delete', 'expected_revision': 1, 'document': doc})
    assert blocked.status_code == 422 and blocked.json()['detail']['code'] == 'REFERENCE_IN_USE'


@pytest.mark.asyncio
async def test_focus_relation_does_not_expand_movement_adoption(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '局部对象'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    def source(ident, port, **extra):
        return {'canvas_id': canvas['id'], 'card_id': ident, 'port_id': port, 'position': 0, **extra}
    doc.update(cards=[{'id': 'person', 'type': 'content.object', 'object_id': 'alice', 'name': '仅焦点对象'}, {'id': 'photo', 'type': 'direction.photography', 'fields': {'movement_path': {'text': '平移', 'state': 'proposal'}}, 'input_bindings': [{'id': 'focus', 'source': source('person', 'object', object_id='alice'), 'input_port': 'focus_object'}]}, {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'move', 'source': source('photo', 'text'), 'input_port': 'text', 'photography_scope': ['region:movement']}]}], edges=[{'id': 'object', 'source_card': 'person', 'source_port': 'object', 'target_card': 'photo', 'target_port': 'focus_object'}, {'id': 'use', 'source_card': 'photo', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'photo': {'focus_object': ['object']}, 'model': {'text': ['use']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert '仅焦点对象' not in compiled['text']
    assert not compiled['used'][0]['payload']['objects']


@pytest.mark.asyncio
async def test_image_does_not_treat_other_explicit_state_as_current_hard_requirement(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '状态限定'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    frames = {'movement_start': {'state': 'proposal', 'text': '门外'}, 'end_frame': {'state': 'proposal', 'text': '窗边'}}
    doc.update(cards=[{'id': ident, 'type': 'direction.photography', 'fields': {**frames, 'shot_size': {'size': size, 'state': 'fact', 'purpose': 'constraint', 'target_id': 'frame1', 'state_id': 'field:movement_start'}}} for ident, size in [('a', 'close_up'), ('b', 'wide')]] + [{'id': 'model', 'type': 'model.image', 'input_bindings': [{'id': ident, 'input_port': 'text', 'source': {'canvas_id': canvas['id'], 'card_id': ident, 'port_id': 'text', 'position': 0}} for ident in ('a', 'b')], 'frame_targets': [{'binding_id': ident, 'state_id': 'field:end_frame'} for ident in ('a', 'b')]}], edges=[{'id': ident, 'source_card': ident, 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'} for ident in ('a', 'b')], input_order={'model': {'text': ['a', 'b']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'CONFLICTING_FRAME_REQUIREMENTS' not in [row['code'] for row in compiled['diagnostics']]
    assert '门外' in compiled['text'] and '窗边' in compiled['text']
