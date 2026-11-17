"""参考只新增图片内容来源；旧固定图片和下游采用不因清理旧来源边而丢失。"""
from tests.canvas_urls import canvas_url, seed_scene_canvas
from copy import deepcopy
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_new_images_require_content_image_and_old_binding_cleanup_keeps_adoption(canvas_client, canvas_file_store):
    from app.models.generation_canvas import GenerationCanvas
    client = canvas_client
    uploaded = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'},
        files={'file': ('legacy.png', b'image', 'image/png')})).json()['data']['id']
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '来源统一'})).json()['data']
    url, doc = canvas_url(f"/canvases/p/{canvas['id']}"), canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'legacy-source', 'port_id': 'image', 'position': 0}
    adopted = {'id': 'use', 'input_port': 'image', 'subject_name': None, 'source': {**source, 'card_id': 'target'}}
    doc.update(cards=[{'id': 'legacy-source', 'type': 'reference.character', 'name': '旧来源', 'image_binding': {'file_id': uploaded}},
        {'id': 'target', 'type': 'reference.character', 'name': '目标', 'image_binding': {'file_id': uploaded, 'source': source}},
        {'id': 'consumer', 'type': 'model.image', 'model_id': 'canvas-image', 'input_bindings': [adopted]}],
        edges=[{'id': 'legacy', 'source_card': 'legacy-source', 'source_port': 'image', 'target_card': 'target', 'target_port': 'image_source'},
               {'id': 'use', 'source_card': 'target', 'source_port': 'image', 'target_card': 'consumer', 'target_port': 'image'}],
        input_order={'target': {'image_source': ['legacy']}, 'consumer': {'image': ['use']}})
    async with canvas_file_store['sessions'].begin() as db:
        stored = await db.get(GenerationCanvas, canvas['id'])
        stored.document = deepcopy(doc)
        stored.card_types = {card['id']: card['type'] for card in doc['cards']}
    before = (await client.get(url + '/cards/consumer/compile')).json()['data']
    response = await client.put(url, json={'request_id': 'cleanup', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    saved = (await client.get(url)).json()['data']['document']
    assert [edge['id'] for edge in saved['edges']] == ['use']
    assert saved['cards'][1]['image_binding']['file_id'] == uploaded
    assert saved['cards'][1]['image_binding']['source'] is None
    assert saved['cards'][2]['input_bindings'] == [adopted]
    after = (await client.get(url + '/cards/consumer/compile')).json()['data']
    assert after['can_run'] and before['text'] == after['text'] and before['media'] == after['media']
    # 旧直接图片可继续重命名；新的直接文件绑定不可绕过图片内容来源。
    saved['cards'][0]['name'] = '旧来源改名'
    assert (await client.put(url, json={'request_id': 'rename', 'expected_revision': 1, 'document': saved})).status_code == 200
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
