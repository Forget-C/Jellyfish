"""Field references are tested at public save, output and compile boundaries."""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401

CASES = [('style', 'direction', 'notes'), ('camera', 'viewpoint', 'support'), ('lighting', 'light_sources', 'color_relationship'), ('focus', 'depth_focus', 'prohibitions'), ('composition', 'composition', 'negative_space'), ('movement', 'movement_path', 'end_frame')]


def referenced(canvas_id, field_id='reference', state='proposal'):
    return {'state': state, 'document': {'segments': [{'id': 'before', 'kind': 'text', 'text': '站在 '}, {'id': field_id, 'kind': 'reference', 'source': {'canvas_id': canvas_id, 'card_id': 'brief', 'port_id': 'text', 'position': 0}}, {'id': 'after', 'kind': 'text', 'text': ' 身后'}]}}


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,key,other', CASES)
async def test_field_documents_expand_once_and_keep_retained_references(canvas_client, kind, key, other):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '参数引用'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document.update(cards=[{'id': 'brief', 'type': 'content.text', 'text': '张三 @图片99 /首帧参考'}, {'id': 'design', 'type': f'direction.{kind}', 'fields': {key: referenced(canvas['id']), other: referenced(canvas['id'], 'retained', 'not_applicable')}}, {'id': 'model', 'type': 'model.text'}], edges=[{'id': 'candidate', 'source_card': 'brief', 'source_port': 'text', 'target_card': 'design', 'target_port': 'text'}, {'id': 'design-input', 'source_card': 'design', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'design': {'text': ['candidate']}, 'model': {'text': ['design-input']}})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})
    assert response.status_code == 200, response.text
    read = (await client.get(url)).json()['data']['document']
    assert read['cards'][1]['fields'][key]['document']['segments'][1]['source']['card_id'] == 'brief'
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    assert '站在 张三 @图片99 /首帧参考 身后' in output['text']
    assert other not in [issue['field_id'] for issue in output['payload'].get('reference_issues', [])]
    document['cards'][2]['input_bindings'] = [{'id': 'use', 'input_port': 'text', 'source': output['source']}]
    assert (await client.put(url, json={'request_id': 'adopt', 'expected_revision': 1, 'document': document})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert '站在 张三 @图片99 /首帧参考 身后' in compiled['text']
    assert not [issue for issue in compiled['diagnostics'] if issue['code'] != 'MODEL_REQUIRED'], compiled
    document['cards'][1]['fields'][key] = {'state': 'empty', 'text': ''}
    document['edges'] = [edge for edge in document['edges'] if edge['id'] != 'candidate']
    document['input_order']['design']['text'] = []
    denied = await client.put(url, json={'request_id': 'disconnect', 'expected_revision': 2, 'document': document})
    assert denied.status_code == 422 and denied.json()['detail']['code'] == 'REFERENCE_IN_USE', denied.text


@pytest.mark.asyncio
async def test_only_active_media_is_declared_and_unsupported_consumption_is_blocked(canvas_client):
    client = canvas_client
    file_id = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('reference.png', b'image', 'image/png')})).json()['data']['id']
    canvas = (await client.post('/canvases/p', json={'name': '素材依赖'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}
    field = {'state': 'proposal', 'document': {'segments': [{'id': 'use', 'kind': 'reference', 'source': source}, {'id': 'repeat', 'kind': 'reference', 'source': source}]}}
    document = canvas['document']
    document.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': file_id}, {'id': 'unused', 'type': 'content.image', 'file_id': file_id}, {'id': 'design', 'type': 'direction.style', 'fields': {'direction': field, 'notes': {**field, 'state': 'not_applicable'}}}, {'id': 'model', 'type': 'model.image', 'model_id': 'canvas-image'}], edges=[{'id': 'a', 'source_card': 'image', 'source_port': 'image', 'target_card': 'design', 'target_port': 'image'}, {'id': 'b', 'source_card': 'unused', 'source_port': 'image', 'target_card': 'design', 'target_port': 'image'}, {'id': 'c', 'source_card': 'design', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'design': {'image': ['a', 'b']}, 'model': {'text': ['c']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    media = output['payload']['material_references']
    assert len(media) == 1
    assert media[0]['source'] == source and media[0]['field_id'] == 'direction'
    assert media[0]['file_id'] == file_id and media[0]['available'] and media[0]['modality'] == 'image'
    document['cards'][3]['input_bindings'] = [{'id': 'adopt', 'input_port': 'text', 'source': output['source']}]
    assert (await client.put(url, json={'request_id': 'adopt', 'expected_revision': 1, 'document': document})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert any(issue['code'] == 'DESIGN_MEDIA_CARRY_NOT_READY' for issue in compiled['diagnostics'])
    document['cards'][2]['fields']['direction']['state'] = 'not_applicable'
    document['cards'][2]['fields']['colors'] = {'text': '保留有效文字', 'state': 'proposal'}
    assert (await client.put(url, json={'request_id': 'inactive', 'expected_revision': 2, 'document': document})).status_code == 200
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    assert not output['payload'].get('material_references')
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert not any(issue['code'] == 'DESIGN_MEDIA_CARRY_NOT_READY' for issue in compiled['diagnostics'])


@pytest.mark.asyncio
@pytest.mark.parametrize('problem', ['foreign', 'missing', 'design_body'])
async def test_active_bad_field_reference_is_located_but_inactive_draft_does_not_block(canvas_client, problem):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '引用诊断'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': 'other' if problem == 'foreign' else canvas['id'], 'card_id': 'upstream', 'port_id': 'text', 'position': 0}
    document = canvas['document']
    upstream = {'id': 'upstream', 'type': 'direction.style', 'fields': {'direction': {'text': '不允许嵌套正文', 'state': 'proposal'}}} if problem == 'design_body' else {'id': 'upstream', 'type': 'content.text', 'text': '普通来源'}
    document.update(cards=[upstream, {'id': 'design', 'type': 'direction.camera', 'fields': {'viewpoint': {'state': 'proposal', 'document': {'segments': [{'id': 'bad', 'kind': 'reference', 'source': source}]}}, 'support': {'text': '有效支撑方式', 'state': 'proposal'}}}, {'id': 'model', 'type': 'model.text', 'model_id': 'canvas-text'}], edges=[{'id': 'use', 'source_card': 'design', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['use']}})
    if problem != 'missing':
        document['edges'].append({'id': 'candidate', 'source_card': 'upstream', 'source_port': 'text', 'target_card': 'design', 'target_port': 'text'})
        document['input_order']['design'] = {'text': ['candidate']}
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})).status_code == 200
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    issue = output['payload']['reference_issues'][0]
    assert issue['field_id'] == 'viewpoint' and issue['reference_id'] == 'bad'
    document['cards'][2]['input_bindings'] = [{'id': 'adopt', 'input_port': 'text', 'source': output['source']}]
    assert (await client.put(url, json={'request_id': 'adopt', 'expected_revision': 1, 'document': document})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert any(item['code'] == issue['code'] and item['target']['card_id'] == 'design' for item in compiled['diagnostics'])
    document['cards'][1]['fields']['viewpoint']['state'] = 'empty'
    assert (await client.put(url, json={'request_id': 'inactive', 'expected_revision': 2, 'document': document})).status_code == 200
    assert not (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]['payload'].get('reference_issues')


@pytest.mark.asyncio
async def test_movement_phase_document_keeps_stable_field_provenance(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '阶段引用'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document.update(cards=[{'id': 'brief', 'type': 'content.text', 'text': '张三'}, {'id': 'design', 'type': 'direction.movement', 'phases': [{'id': 'stable', 'name': '起步', 'frame': referenced(canvas['id'])}]}], edges=[{'id': 'candidate', 'source_card': 'brief', 'source_port': 'text', 'target_card': 'design', 'target_port': 'text'}], input_order={'design': {'text': ['candidate']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})).status_code == 200
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    assert output['payload']['frame_states'] == [{'id': 'phase:stable', 'label': '起步'}]
    assert output['payload']['movement_phases'][0]['frame']['text'] == '站在 张三 身后'
    document['cards'][1]['phases'][0]['name'] = '改名'
    assert (await client.put(url, json={'request_id': 'rename', 'expected_revision': 1, 'document': document})).status_code == 200
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    assert output['payload']['frame_states'] == [{'id': 'phase:stable', 'label': '改名'}]


@pytest.mark.asyncio
async def test_authored_unconfirmed_token_is_diagnosed_and_escaped_token_is_literal(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '未确认代号'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document['cards'] = [{'id': 'design', 'type': 'direction.style', 'fields': {'direction': {'state': 'proposal', 'document': {'segments': [{'id': 'literal', 'kind': 'text', 'text': '@图片99'}]}}}}]
    assert (await client.put(url, json={'request_id': 'draft', 'expected_revision': 0, 'document': document})).status_code == 200
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    assert output['payload']['reference_issues'][0]['code'] == 'UNCONFIRMED_REFERENCE'
    document['cards'][0]['fields']['direction']['document']['segments'][0]['text'] = r'\@图片99'
    assert (await client.put(url, json={'request_id': 'escaped', 'expected_revision': 1, 'document': document})).status_code == 200
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    assert not output['payload'].get('reference_issues')
    assert '@图片99' in output['text'] and '\\@' not in output['text']
