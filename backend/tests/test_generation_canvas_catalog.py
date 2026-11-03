"""卡片目录经公开 HTTP 提供端点及产品分类；不从前端名称猜协议。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_canvas_catalog_exposes_real_ports_groups_and_adoption(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '类型目录'})).json()['data']
    response = await client.get(f"/canvases/p/{canvas['id']}/catalog")
    assert response.status_code == 200, response.text
    cards = {item['type']: item for item in response.json()['data']['cards']}
    assert cards['direction.composition']['title'] == '景别与构图卡'
    assert {field['id'] for field in cards['direction.composition']['fields']} == {'shot_size', 'composition', 'frame_position', 'depth_layers', 'negative_space', 'composition_requirements'}
    assert cards['direction.composition']['outputs'][0]['adoption'] == 'whole_card'
    assert cards['reference.character']['group'] == '基础内容' and cards['reference.character']['modality'] == 'image'
    movement = cards['direction.movement']
    assert movement['category'] == '画面设计' and movement['entries'] == []
    assert [field['id'] for field in movement['fields']] == ['movement_type', 'movement_start', 'movement_trigger', 'movement_path', 'movement_speed', 'end_frame']
    assert movement['outputs'][0]['adoption'] == 'whole_card'
    photo = cards['direction.photography']
    assert photo['category'] == '画面设计' and len(photo['entries']) == 5
    assert photo['outputs'][0]['adoption'] == 'declared_scope'
    assert cards['direction.performance']['outputs'][0]['adoption'] == 'whole_card'
    for kind, field in [('camera', 'viewpoint'), ('lighting', 'light_sources'), ('focus', 'depth_focus')]:
        design = cards['direction.' + kind]
        assert design['category'] == '画面设计' and not design['entries']
        assert design['outputs'][0]['adoption'] == 'whole_card'
        assert field in {item['id'] for item in design['fields']}
        assert 'movement_type' not in {item['id'] for item in design['fields']}
    assert cards['direction.anchor']['category'] == '表演与调度'
    assert cards['direction.dialogue']['category'] == '声音设计'
    assert cards['direction.shot']['category'] == '叙事与镜头'
    inputs = {port['id'] for card in cards.values() for port in card['inputs']}
    assert {'text', 'image', 'video', 'audio', 'object'} <= inputs
    for kind in ('style', 'camera', 'lighting', 'focus', 'composition', 'movement'):
        assert {'text', 'image', 'video', 'audio', 'object'} <= {port['id'] for port in cards['direction.' + kind]['inputs']}
    effect = lambda card: next(port for port in cards[card]['inputs'] if port['id'] == 'effect_object')['accepts']
    assert 'shot' in effect('direction.fact') and 'shot' not in effect('direction.criterion')
    assert effect('direction.performance') == ['object_reference']
    assert next(port for port in cards['direction.performance']['inputs'] if port['id'] == 'dialogue_basis')['accepts'] == ['dialogue']
    assert {'id': 'physical_action', 'label': '身体动作'} in cards['direction.performance']['fields']
    assert (await client.get('/canvases/p/missing/catalog')).status_code == 404


@pytest.mark.asyncio
async def test_public_output_modality_has_only_four_content_modalities(canvas_client):
    schema = (await canvas_client.get('/openapi.json')).json()
    assert schema['components']['schemas']['CanvasResolvedOutput']['properties']['modality']['enum'] == ['text', 'image', 'video', 'audio']
