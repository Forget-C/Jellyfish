"""独立构图通过公开保存与编译保持自己的参数。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_composition_preserves_framing_and_whole_design(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '构图'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document.update(cards=[{'id': 'composition', 'type': 'direction.composition', 'fields': {
        'shot_size': {'size': 'close_up', 'text': '人物特写', 'state': 'fact'},
        'composition': {'text': '前后层次', 'state': 'proposal'},
        'negative_space': {'text': '右侧留白', 'state': 'fact', 'purpose': 'constraint'}}},
        {'id': 'model', 'type': 'model.text'}], edges=[{'id': 'e', 'source_card': 'composition', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['e']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    output = (await client.get(url + '/cards/composition/outputs')).json()['data']['outputs'][0]
    assert output['payload']['adoption'] == 'whole_card'
    assert output['payload']['fields']['shot_size']['size'] == 'close_up'
    assert len((await client.get(url + '/cards/model/compile')).json()['data']['used']) == 1
    document['cards'][1]['input_bindings'] = [{'id': 'use', 'input_port': 'text', 'source': output['source']}]
    assert (await client.put(url, json={'request_id': 'adopt', 'expected_revision': 1, 'document': document})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert all(text in compiled['text'] for text in ('人物特写', '前后层次', '右侧留白'))
    read = (await client.get(url)).json()['data']['document']['cards'][0]
    assert read['fields']['negative_space']['purpose'] == 'constraint'
    document['cards'][0]['fields']['movement_path'] = {'text': '不属于构图', 'state': 'fact'}
    assert (await client.put(url, json={'request_id': 'invalid', 'expected_revision': 2, 'document': document})).status_code == 422
