"""Independent visual designs through public save/compile interfaces."""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,key,text', [('camera', 'viewpoint', '低机位观察'), ('lighting', 'light_sources', '窗边自然光'), ('focus', 'depth_focus', '清楚的主体焦点')])
async def test_independent_design_saves_reopens_and_requires_whole_adoption(canvas_client, kind, key, text):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '独立设计'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document.update(cards=[{'id': 'design', 'type': f'direction.{kind}', 'fields': {key: {'text': text, 'state': 'fact'}}}, {'id': 'model', 'type': 'model.text'}, {'id': 'second', 'type': f'direction.{kind}', 'fields': {key: {'text': '另一张独立设计', 'state': 'proposal'}}}], edges=[{'id': 'e', 'source_card': 'design', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['e']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    read = (await client.get(url)).json()['data']['document']
    assert read['cards'][0]['fields'][key]['text'] == text
    assert 'movement_type' not in read['cards'][0]['fields']
    assert read['cards'][2]['fields'][key]['text'] == '另一张独立设计'
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    assert output['payload']['design_type'] == f'direction.{kind}'
    assert output['payload']['adoption'] == 'whole_card'
    assert not (await client.get(url + '/cards/model/compile')).json()['data']['used']
    document['cards'][1]['input_bindings'] = [{'id': 'adopt', 'input_port': 'text', 'source': output['source']}]
    assert (await client.put(url, json={'request_id': 'adopt', 'expected_revision': 1, 'document': document})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert text in compiled['text']
    assert '另一张独立设计' not in compiled['text']
    assert compiled['used'][0]['payload']['adoption'] == 'whole_card'
    document['cards'][0]['fields']['movement_type'] = {'text': '不得串入运镜', 'state': 'proposal'}
    invalid = await client.put(url, json={'request_id': 'invalid', 'expected_revision': 2, 'document': document})
    assert invalid.status_code == 422, invalid.text
