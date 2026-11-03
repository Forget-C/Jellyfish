"""独立构图定位运镜及静帧目标经公开接口验收。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


async def setup_target(client):
    canvas = (await client.post('/canvases/p', json={'name': '定位'})).json()['data']
    source = {'canvas_id': canvas['id'], 'card_id': 'composition', 'port_id': 'text', 'position': 0}
    doc = canvas['document']
    doc.update(cards=[{'id': 'movement', 'type': 'direction.movement', 'fields': {
        'movement_path': {'state': 'proposal', 'text': '不应隐式采用的运动路径'}},
        'phases': [{'id': 'end', 'name': '落幅', 'frame': {'state': 'fact', 'text': '站在窗边'}}]},
        {'id': 'composition', 'type': 'direction.composition', 'fields': {
            'shot_size': {'size': 'close_up', 'state': 'fact', 'purpose': 'constraint'}},
         'frame_target': {'card_id': 'movement', 'state_id': 'phase:end'}},
        {'id': 'model', 'type': 'model.image', 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text'}]}],
        edges=[{'id': 'e', 'source_card': 'composition', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'model': {'text': ['e']}})
    return f"/canvases/p/{canvas['id']}", doc


@pytest.mark.asyncio
async def test_composition_target_keeps_stable_identity_without_adopting_movement(canvas_client):
    client = canvas_client
    url, doc = await setup_target(client)
    response = await client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    first = (await client.get(url + '/cards/model/compile')).json()['data']
    assert '不应隐式采用的运动路径' not in first['text'] and '站在窗边' not in first['text']
    assert len(first['used']) == 1 and first['used'][0]['source']['card_id'] == 'composition'
    assert first['used'][0]['payload']['frame_target_state']['label'] == '落幅'
    doc['cards'][0]['phases'][0]['name'] = '结束近景'
    response = await client.put(url, json={'request_id': 'rename', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 200, response.text
    second = (await client.get(url + '/cards/model/compile')).json()['data']
    assert second['used'][0]['payload']['frame_target_state']['target']['state_id'] == 'phase:end'
    assert second['used'][0]['payload']['frame_target_state']['label'] == '结束近景'
    doc['cards'][0]['phases'] = []
    assert (await client.put(url, json={'request_id': 'delete', 'expected_revision': 2, 'document': doc})).status_code == 200
    missing = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'DESIGN_FRAME_TARGET_MISSING' in [d['code'] for d in missing['diagnostics']]


@pytest.mark.asyncio
async def test_explicit_same_state_hard_composition_conflict_is_reported(canvas_client):
    client = canvas_client
    url, doc = await setup_target(client)
    canvas_id = doc['id']
    doc['cards'].insert(2, {'id': 'other', 'type': 'direction.composition',
        'fields': {'shot_size': {'size': 'wide', 'state': 'fact', 'purpose': 'constraint'}},
        'frame_target': {'card_id': 'movement', 'state_id': 'phase:end'}})
    doc['cards'][-1]['input_bindings'].append({'id': 'second', 'input_port': 'text',
        'source': {'canvas_id': canvas_id, 'card_id': 'other', 'port_id': 'text', 'position': 0}})
    doc['edges'].append({'id': 'second', 'source_card': 'other', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'})
    doc['input_order']['model']['text'].append('second')
    assert (await client.put(url, json={'request_id': 'conflict', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'CONFLICTING_FRAME_REQUIREMENTS' in [d['code'] for d in compiled['diagnostics']]
    doc['cards'][2]['fields']['shot_size']['state'] = 'proposal'
    assert (await client.put(url, json={'request_id': 'proposal', 'expected_revision': 1, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'CONFLICTING_FRAME_REQUIREMENTS' not in [d['code'] for d in compiled['diagnostics']]


@pytest.mark.asyncio
async def test_image_goal_keeps_whole_movement_and_requires_only_multiple_states(canvas_client):
    client = canvas_client
    url, doc = await setup_target(client)
    doc['cards'][-1]['input_bindings'] = [{'id': 'move-use', 'input_port': 'text', 'source': {
        'canvas_id': doc['id'], 'card_id': 'movement', 'port_id': 'text', 'position': 0}}]
    doc['edges'] = [{'id': 'm', 'source_card': 'movement', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}]
    doc['input_order'] = {'model': {'text': ['m']}}
    doc['cards'][0]['fields']['movement_start'] = {'state': 'fact', 'text': '门外全景'}
    assert (await client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})).status_code == 200
    first = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'FRAME_TARGET_REQUIRED' in [d['code'] for d in first['diagnostics']]
    doc['cards'][-1]['frame_targets'] = [{'binding_id': 'move-use', 'state_id': 'phase:end'}]
    assert (await client.put(url, json={'request_id': 'target', 'expected_revision': 1, 'document': doc})).status_code == 200
    second = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'FRAME_TARGET_REQUIRED' not in [d['code'] for d in second['diagnostics']]
    assert all(text in second['text'] for text in ['门外全景', '站在窗边', '不应隐式采用的运动路径', '画面目标：落幅'])
    doc['cards'][0]['phases'][0]['frame']['state'] = 'not_applicable'
    assert (await client.put(url, json={'request_id': 'missing', 'expected_revision': 2, 'document': doc})).status_code == 200
    third = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'FRAME_TARGET_MISSING' in [d['code'] for d in third['diagnostics']]
    doc['cards'][-1]['frame_targets'] = []
    assert (await client.put(url, json={'request_id': 'single', 'expected_revision': 3, 'document': doc})).status_code == 200
    single = (await client.get(url + '/cards/model/compile')).json()['data']
    assert not {'FRAME_TARGET_REQUIRED', 'FRAME_TARGET_MISSING'} & {d['code'] for d in single['diagnostics']}
    doc['cards'][0]['phases'][0]['frame'] = {'state': 'proposal', 'text': '   '}
    assert (await client.put(url, json={'request_id': 'blank', 'expected_revision': 4, 'document': doc})).status_code == 200
    blank = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'FRAME_TARGET_REQUIRED' not in {d['code'] for d in blank['diagnostics']}



@pytest.mark.asyncio
async def test_target_basis_ignores_unrelated_movement_but_freezes_selected_state(runtime, image_storage):
    import asyncio
    import base64
    import json
    import httpx
    from tests.test_generation_canvas_images import image_card
    from app.task_worker import TaskWorker
    await image_card(runtime, count=1)
    doc = runtime.document
    source = {'canvas_id': runtime.canvas_id, 'card_id': 'composition', 'port_id': 'text', 'position': 0}
    doc['cards'] = [
        {'id': 'movement', 'type': 'direction.movement', 'fields': {'movement_path': {'state': 'proposal', 'text': '未采用的路径'}},
         'phases': [{'id': 'end', 'name': '落幅', 'frame': {'state': 'fact', 'text': '原画面'}}]},
        {'id': 'composition', 'type': 'direction.composition', 'fields': {'composition': {'state': 'fact', 'text': '左侧构图'}},
         'frame_target': {'card_id': 'movement', 'state_id': 'phase:end'}},
        {**doc['cards'][0], 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text'}]}]
    doc['edges'] = [{'id': 'e', 'source_card': 'composition', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}]
    doc['input_order'] = {'image': {'text': ['e']}}
    async def save(revision):
        result = await runtime.client.put(runtime.url, json={'request_id': str(revision), 'expected_revision': revision, 'document': doc})
        assert result.status_code == 200, result.text
    async def precheck():
        result = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'image'})).json()['data']
        assert result['can_run'], result
        return result
    await save(2)
    first = await precheck()
    doc['cards'][0]['phases'][0]['frame']['text'] = '新的相关画面'
    await save(3)
    stale = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'stale', 'preview_token': first['preview_token']})
    assert stale.status_code == 409, stale.text
    current = await precheck()
    doc['cards'][0]['fields']['movement_path']['text'] = '无关路径修改'
    await save(4)
    current = await precheck()  # Any document revision requires a fresh token; basis relevance is checked through results below.
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'accepted', 'preview_token': current['preview_token']})
    assert accepted.status_code == 200, accepted.text
    doc['cards'][0]['phases'][0]['name'] = '运行后修改'
    doc['cards'][1]['fields']['composition']['text'] = '运行后新构图'
    await save(5)
    calls = []
    def provider(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'image').decode()}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1
    assert calls[0]['prompt'] == current['input']['text']
    assert '运行后新构图' not in calls[0]['prompt'] and '无关路径修改' not in calls[0]['prompt']
    run = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['runs'][0]
    target = run['nodes'][0]['basis']['input']['used'][0]['payload']['frame_target_state']
    assert target['frame']['text'] == '新的相关画面' and target['label'] == '落幅'
    latest = await precheck()
    second_run = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'latest', 'preview_token': latest['preview_token']})
    assert second_run.status_code == 200, second_run.text
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    doc['cards'][0]['fields']['movement_path']['text'] = '又一个未采用的路径'
    await save(6)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['current_outputs']['image'][0]['basis_current']
    doc['cards'][0]['phases'][0]['frame']['text'] = '相关画面再次变化'
    await save(7)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert not state['current_outputs']['image'][0]['basis_current']



from tests.test_generation_canvas_runs import runtime  # noqa: F401,E402
from tests.test_generation_canvas_images import image_storage  # noqa: F401,E402
