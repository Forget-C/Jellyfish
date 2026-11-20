"""命名参考的图片来源，以及解除来源后的固定图片。"""
from tests.canvas_urls import canvas_url, seed_scene_canvas
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_unbinding_current_image_source_keeps_pinned_file_and_adoption(canvas_client, canvas_file_store):
    client = canvas_client
    uploaded = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'},
        files={'file': ('reference.png', b'image', 'image/png')})).json()['data']['id']
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '解除来源'})).json()['data']
    url, document = canvas_url(f"/canvases/p/{canvas['id']}"), canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}
    adopted = {'id': 'use', 'input_port': 'image', 'subject_name': None, 'source': {**source, 'card_id': 'target'}}
    document.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': uploaded},
        {'id': 'target', 'type': 'reference.character', 'name': '目标', 'image_binding': {'file_id': uploaded, 'source': source}},
        {'id': 'consumer', 'type': 'model.image', 'model_id': 'canvas-image', 'input_bindings': [adopted]}],
        edges=[{'id': 'main', 'source_card': 'image', 'source_port': 'image', 'target_card': 'target', 'target_port': 'image_source'},
               {'id': 'use', 'source_card': 'target', 'source_port': 'image', 'target_card': 'consumer', 'target_port': 'image'}],
        input_order={'target': {'image_source': ['main']}, 'consumer': {'image': ['use']}})
    response = await client.put(url, json={'request_id': 'bind', 'expected_revision': 0, 'document': document})
    assert response.status_code == 200, response.text
    saved = (await client.get(url)).json()['data']['document']
    before = (await client.get(url + '/cards/consumer/compile')).json()['data']
    saved['edges'] = [edge for edge in saved['edges'] if edge['id'] != 'main']
    saved['input_order'].pop('target')
    saved['cards'][1]['image_binding']['source'] = None
    response = await client.put(url, json={'request_id': 'unbind', 'expected_revision': 1, 'document': saved})
    assert response.status_code == 200, response.text
    saved = (await client.get(url)).json()['data']['document']
    assert saved['cards'][1]['image_binding']['file_id'] == uploaded
    assert saved['cards'][1]['image_binding']['source'] is None
    assert saved['cards'][2]['input_bindings'] == [adopted]
    after = (await client.get(url + '/cards/consumer/compile')).json()['data']
    assert after['can_run'] and before['text'] == after['text'] and before['media'] == after['media']
    saved['cards'].append({'id': 'new', 'type': 'reference.prop', 'name': '新参考', 'image_binding': {'file_id': uploaded}})
    response = await client.put(url, json={'request_id': 'direct', 'expected_revision': 2, 'document': saved})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'INVALID_REFERENCE_SOURCE'


@pytest.mark.asyncio
@pytest.mark.parametrize('source_type', ['model.image', 'reference.character'])
async def test_new_non_content_image_connections_are_rejected(canvas_client, source_type):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '拒绝新来源'})).json()['data']
    doc = canvas['document']
    doc.update(cards=[{'id': 'source', 'type': source_type}, {'id': 'target', 'type': 'reference.character'}],
        edges=[{'id': 'e', 'source_card': 'source', 'source_port': 'image', 'target_card': 'target', 'target_port': 'image_source'}], input_order={'target': {'image_source': ['e']}})
    response = await client.put(canvas_url(f"/canvases/p/{canvas['id']}"), json={'request_id': 'new', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'INVALID_REFERENCE_SOURCE'
