"""来源多路径采用和解除经公开 HTTP 验证。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_requirement_paths_release_independently(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '逐路径解除'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = lambda card: {'canvas_id': canvas['id'], 'card_id': card, 'port_id': 'text', 'position': 0}
    doc = canvas['document']
    doc.update(cards=[{'id': 'a', 'type': 'content.text', 'text': '来源唯一正文'},
        {'id': 'b', 'type': 'direction.criterion', 'criterion_id': 'b', 'name': '标准一',
         'standard': {'state': 'fact', 'document': {'segments': [
             {'id': 'before', 'kind': 'text', 'text': '先核对'},
             {'id': 'first', 'kind': 'reference', 'source': source('a')},
             {'id': 'middle', 'kind': 'text', 'text': '再核对'},
             {'id': 'second', 'kind': 'reference', 'source': source('a')}]}}},
        {'id': 'c', 'type': 'direction.shot', 'shot_id': 'c', 'name': '设计一', 'visible_result': {'state': 'fact', 'text': '设计正文'}},
        {'id': 'd', 'type': 'model.text'}], edges=[
        {'id': 'ab', 'source_card': 'a', 'source_port': 'text', 'target_card': 'b', 'target_port': 'text'},
        {'id': 'bc', 'source_card': 'b', 'source_port': 'criterion', 'target_card': 'c', 'target_port': 'acceptance_basis'},
        *[{'id': name + 'd', 'source_card': name, 'source_port': 'text', 'target_card': 'd', 'target_port': 'text'} for name in ['b', 'c']]],
        input_order={'b': {'text': ['ab']}, 'c': {'acceptance_basis': ['bc']}, 'd': {'text': ['bd', 'cd']}})
    revision = 0

    async def save():
        nonlocal doc, revision
        result = await client.put(url, json={'request_id': f'save-{revision}', 'expected_revision': revision, 'document': doc})
        assert result.status_code == 200, result.text
        state = (await client.get(url)).json()['data']
        doc, revision = state['document'], state['revision']

    async def used():
        compiled = (await client.get(url + '/cards/d/compile')).json()['data']
        identities = [item['source']['card_id'] for item in compiled['used']]
        assert len(identities) == len(set(identities)), compiled
        return set(identities), compiled

    def disconnect(edge_id):
        doc['edges'] = [edge for edge in doc['edges'] if edge['id'] != edge_id]
        for ports in doc['input_order'].values():
            for port, ids in ports.items():
                ports[port] = [ident for ident in ids if ident != edge_id]

    await save()
    identities, compiled = await used()
    assert identities == {'a', 'b', 'c'}
    assert compiled['text'].count('来源唯一正文') == 1
    assert '先核对' in compiled['text'] and '再核对' in compiled['text']
    assert [part['id'] for part in doc['cards'][1]['standard']['document']['segments'] if part['kind'] == 'reference'] == ['first', 'second']
    disconnect('bc')
    await save()
    assert (await used())[0] == {'a', 'b', 'c'}
    doc['edges'].append({'id': 'bc', 'source_card': 'b', 'source_port': 'criterion', 'target_card': 'c', 'target_port': 'acceptance_basis'})
    doc['input_order']['c']['acceptance_basis'] = ['bc']
    await save()
    disconnect('bd')
    await save()
    assert (await used())[0] == {'a', 'b', 'c'}
    doc['edges'].append({'id': 'ad', 'source_card': 'a', 'source_port': 'text', 'target_card': 'd', 'target_port': 'text'})
    doc['input_order']['d']['text'].append('ad')
    doc['cards'][-1]['input_bindings'].append({'id': 'ad', 'input_port': 'text', 'source': source('a')})
    await save()
    disconnect('bc')
    await save()
    assert (await used())[0] == {'a', 'c'}
    disconnect('cd')
    await save()
    assert (await used())[0] == {'a'}


@pytest.mark.asyncio
async def test_equal_requirement_text_keeps_distinct_sources(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '同文不同身份'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc.update(cards=[*[
        {'id': name, 'type': 'direction.criterion', 'criterion_id': name, 'name': name,
         'standard': {'state': 'fact', 'text': '相同标准正文'}} for name in ['first', 'second']],
        {'id': 'model', 'type': 'model.text'}], edges=[
        {'id': name, 'source_card': name, 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'} for name in ['first', 'second']],
        input_order={'model': {'text': ['first', 'second']}})
    saved = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await canvas_client.get(url + '/cards/model/compile')).json()['data']
    assert compiled['text'].count('相同标准正文') == 2
    assert {item['source']['card_id'] for item in compiled['used']} == {'first', 'second'}


@pytest.mark.asyncio
async def test_missing_effective_source_blocks_only_adopted_standard_and_retains_protection(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '失效来源草稿'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'a', 'port_id': 'text', 'position': 0}
    doc = canvas['document']
    doc.update(cards=[{'id': 'a', 'type': 'content.text', 'text': '参考正文'},
        {'id': 'b', 'type': 'direction.criterion', 'criterion_id': 'b', 'name': '标准',
         'standard': {'state': 'fact', 'document': {'segments': [{'id': 'ref', 'kind': 'reference', 'source': source}]}}},
        {'id': 'd', 'type': 'model.text'}], edges=[
        {'id': 'ab', 'source_card': 'a', 'source_port': 'text', 'target_card': 'b', 'target_port': 'text'},
        {'id': 'bd', 'source_card': 'b', 'source_port': 'text', 'target_card': 'd', 'target_port': 'text'}],
        input_order={'b': {'text': ['ab']}, 'd': {'text': ['bd']}})
    response = await canvas_client.put(url, json={'request_id': 'initial', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    doc = (await canvas_client.get(url)).json()['data']['document']
    doc['cards'][0]['text'] = ''
    response = await canvas_client.put(url, json={'request_id': 'missing', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 200, response.text
    reopened = (await canvas_client.get(url)).json()['data']['document']
    assert reopened['cards'][1]['standard']['document']['segments'][0]['source'] == source
    compiled = (await canvas_client.get(url + '/cards/d/compile')).json()['data']
    assert any(issue['code'] != 'MODEL_REQUIRED' and 'run' in issue['blocks'] for issue in compiled['diagnostics']), compiled
    doc = reopened
    doc['cards'][1]['standard']['state'] = 'not_applicable'
    response = await canvas_client.put(url, json={'request_id': 'inactive', 'expected_revision': 2, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await canvas_client.get(url + '/cards/d/compile')).json()['data']
    assert {item['source']['card_id'] for item in compiled['used']} == {'b'}
    assert not [issue for issue in compiled['diagnostics'] if issue['code'] != 'MODEL_REQUIRED'], compiled
    doc['cards'] = doc['cards'][1:]
    doc['edges'] = doc['edges'][1:]
    doc['input_order']['b']['text'] = []
    response = await canvas_client.put(url, json={'request_id': 'delete-source', 'expected_revision': 3, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'REFERENCE_IN_USE', response.text
