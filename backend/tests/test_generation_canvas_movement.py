"""独立运镜通过公开保存和编译边界验证。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_movement_publishes_whole_design_and_stable_frames(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '独立运镜'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'move', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'move', 'type': 'direction.movement', 'fields': {
        'movement_start': {'state': 'proposal', 'text': '门外全景'},
        'end_frame': {'state': 'fact', 'text': '窗边特写'},
        'movement_path': {'state': 'proposal', 'text': '沿走廊推进'}},
        'phases': [{'id': 'pause', 'name': '停顿', 'frame': {'state': 'proposal', 'text': '经过门口'}}]},
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text'}]}],
        edges=[{'id': 'e', 'source_card': 'move', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['e']}})
    saved = await client.put(url, json={'request_id': 'create', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    payload = (await client.get(url + '/cards/move/outputs')).json()['data']['outputs'][0]['payload']
    assert payload['adoption'] == 'whole_card'
    assert payload['design_type'] == 'direction.movement'
    assert [item['id'] for item in payload['frame_states']] == ['field:movement_start', 'field:end_frame', 'phase:pause']
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert all(text in compiled['text'] for text in ['门外全景', '窗边特写', '沿走廊推进', '经过门口'])
    assert payload['movement_phases'][0]['id'] == 'pause'


@pytest.mark.asyncio
async def test_movement_rejects_foreign_fields_and_duplicate_phase_identity(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '校验'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    for content in ({'fields': {'light_sources': {'state': 'proposal', 'text': '侧光'}}},
                    {'phases': [{'id': 'same'}, {'id': 'same'}]}):
        doc = {**canvas['document'], 'cards': [{'id': 'move', 'type': 'direction.movement', **content}]}
        response = await canvas_client.put(url, json={'request_id': 'invalid', 'expected_revision': 0, 'document': doc})
        assert response.status_code == 422, response.text
    saved = (await canvas_client.get(url)).json()['data']
    assert saved['revision'] == 0 and saved['document']['cards'] == []


@pytest.mark.asyncio
async def test_movement_phase_rename_reorder_and_inactive_frame_keep_identity(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '阶段'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc['cards'] = [{'id': 'move', 'type': 'direction.movement', 'phases': [
        {'id': 'a', 'name': '门口', 'frame': {'state': 'fact', 'text': '停在门口'}},
        {'id': 'b', 'name': '窗边', 'frame': {'state': 'proposal', 'text': '转向窗边'}}]}]
    async def save(revision):
        response = await canvas_client.put(url, json={'request_id': str(revision), 'expected_revision': revision, 'document': doc})
        assert response.status_code == 200, response.text
        return (await canvas_client.get(url + '/cards/move/outputs')).json()['data']['outputs'][0]['payload']
    assert [x['id'] for x in (await save(0))['frame_states']] == ['phase:a', 'phase:b']
    doc['cards'][0]['phases'].reverse()
    doc['cards'][0]['phases'][1]['name'] = '落幅'
    renamed = await save(1)
    assert renamed['frame_states'] == [{'id': 'phase:b', 'label': '窗边'}, {'id': 'phase:a', 'label': '落幅'}]
    doc['cards'][0]['phases'][1]['frame']['state'] = 'not_applicable'
    inactive = await save(2)
    assert [x['id'] for x in inactive['frame_states']] == ['phase:b']
    assert inactive['movement_phases'][1]['frame']['text'] == '停在门口'
    assert '停在门口' not in inactive['text']
    doc['cards'][0]['phases'].pop()
    assert [x['id'] for x in (await save(3))['movement_phases']] == ['b']


@pytest.mark.asyncio
async def test_movement_retains_explicit_object_relationship_and_scope(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '关系'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'person', 'port_id': 'object', 'position': 0, 'object_id': 'person-id'}
    doc.update(cards=[{'id': 'person', 'type': 'content.character', 'object_id': 'person-id', 'name': '张三', 'text': '穿着外套'},
                      {'id': 'move', 'type': 'direction.movement', 'scope': {'description': '门口一段'}, 'source_locator': '创作要求',
                       'input_bindings': [{'id': 'object', 'source': source, 'input_port': 'effect_object'}]}],
               edges=[{'id': 'e', 'source_card': 'person', 'source_port': 'object', 'target_card': 'move', 'target_port': 'effect_object'}],
               input_order={'move': {'effect_object': ['e']}})
    response = await canvas_client.put(url, json={'request_id': 'object', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    payload = (await canvas_client.get(url + '/cards/move/outputs')).json()['data']['outputs'][0]['payload']
    assert payload['objects'][0]['name'] == '张三'
    assert '作用对象：张三' in payload['text']
    assert '适用范围：门口一段' in payload['text']
