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
    assert len((await client.get(url + '/cards/model/compile')).json()['data']['used']) == 1
    document['cards'][1]['input_bindings'] = [{'id': 'adopt', 'input_port': 'text', 'source': output['source']}]
    assert (await client.put(url, json={'request_id': 'adopt', 'expected_revision': 1, 'document': document})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert text in compiled['text']
    assert '另一张独立设计' not in compiled['text']
    assert compiled['used'][0]['payload']['adoption'] == 'whole_card'
    document['cards'][0]['fields']['movement_type'] = {'text': '不得串入运镜', 'state': 'proposal'}
    invalid = await client.put(url, json={'request_id': 'invalid', 'expected_revision': 2, 'document': document})
    assert invalid.status_code == 422, invalid.text


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,key', [('camera', 'viewpoint'), ('lighting', 'light_sources'), ('focus', 'depth_focus'), ('composition', 'composition'), ('movement', 'movement_type')])
async def test_visual_generic_object_retires_without_losing_explicit_references(canvas_client, kind, key):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '明确画面来源'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'person', 'port_id': 'text', 'position': 0}
    object_source = {**source, 'port_id': 'object', 'object_id': 'actor'}
    bindings = [{'id': 'old', 'input_port': 'effect_object', 'source': object_source}]
    edges = [{'id': 'old', 'source_card': 'person', 'source_port': 'object', 'target_card': 'design', 'target_port': 'effect_object'}, {'id': 'text', 'source_card': 'person', 'source_port': 'text', 'target_card': 'design', 'target_port': 'text'}]
    if kind in ('movement', 'focus'):
        bindings.append({'id': 'attention', 'input_port': 'attention_object', 'source': object_source})
        edges.append({'id': 'attention', 'source_card': 'person', 'source_port': 'object', 'target_card': 'design', 'target_port': 'attention_object'})
    if kind == 'focus':
        bindings.append({'id': 'focus', 'input_port': 'focus_object', 'source': object_source})
        edges.append({'id': 'focus', 'source_card': 'person', 'source_port': 'object', 'target_card': 'design', 'target_port': 'focus_object'})
    doc = canvas['document']
    doc.update(cards=[{'id': 'person', 'type': 'content.character', 'object_id': 'actor', 'name': '张三', 'text': '完整人物说明'}, {'id': 'design', 'type': f'direction.{kind}', 'fields': {key: {'state': 'fact', 'text': '@人物设计', 'document': {'segments': [{'id': 'ref', 'kind': 'reference', 'source': source}, {'id': 'tail', 'kind': 'text', 'text': '设计'}]}}}, 'input_bindings': bindings}], edges=edges, input_order={'design': {edge['target_port']: [edge['id']] for edge in edges}})
    response = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    reopened = (await canvas_client.get(url)).json()['data']['document']
    design = reopened['cards'][1]
    assert all(binding['input_port'] != 'effect_object' for binding in design['input_bindings'])
    assert [binding['input_port'] for binding in design['input_bindings']] == (['attention_object', 'focus_object'] if kind == 'focus' else ['attention_object'] if kind == 'movement' else [])
    assert design['fields'][key]['document']['segments'][0]['source'] == source
    assert not any(edge['target_port'] == 'effect_object' for edge in reopened['edges'])
    output = (await canvas_client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    assert '完整人物说明' in output['text']
    assert '作用对象：' not in output['text']


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['camera', 'lighting', 'focus', 'composition', 'movement'])
async def test_visual_old_object_document_read_is_idempotent(canvas_client, canvas_file_store, kind):
    from app.models.generation_canvas import GenerationCanvas
    canvas = (await canvas_client.post('/canvases/p', json={'name': '旧画面对象'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'prop', 'port_id': 'object', 'position': 0, 'object_id': 'key'}
    doc.update(cards=[{'id': 'prop', 'type': 'content.prop', 'object_id': 'key', 'name': '钥匙', 'text': '完整钥匙说明'}, {'id': 'visual', 'type': 'direction.' + kind, 'input_bindings': [{'id': 'old', 'input_port': 'effect_object', 'source': source}]}], edges=[{'id': 'old', 'source_card': 'prop', 'source_port': 'object', 'target_card': 'visual', 'target_port': 'effect_object'}], input_order={'visual': {'effect_object': ['old']}})
    async with canvas_file_store['sessions'].begin() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        row.document = doc
    first = (await canvas_client.get(url)).json()['data']
    second = (await canvas_client.get(url)).json()['data']
    assert first == second
    assert first['revision'] == 1
    assert first['document']['cards'][1]['input_bindings'] == []
    assert first['document']['edges'] == [{'id': 'old', 'source_card': 'prop', 'source_port': 'text', 'target_card': 'visual', 'target_port': 'text'}]
    assert first['document']['input_order'] == {'visual': {'text': ['old']}}
    assert (await canvas_client.put(url, json={'request_id': 'stale', 'expected_revision': 0, 'document': doc})).status_code == 409
