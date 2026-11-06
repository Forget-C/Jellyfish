"""Canvas save media inventory through HTTP, including fixed files and first-error order."""
from copy import deepcopy
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401
from tests.test_generation_canvas_reference_save import reference_document, save


async def media_document(client):
    url, doc, files = await reference_document(client)
    source = deepcopy(doc['cards'][1]['image_binding']['source'])
    doc['cards'].append({'id': 'design', 'type': 'direction.anchor',
        'examples': [{'id': 'e', 'file_id': files[0], 'source': source}]})
    doc['edges'].append({'id': 'example-edge', 'source_card': 'image', 'source_port': 'image',
        'target_card': 'design', 'target_port': 'image_example'})
    doc['input_order']['design'] = {'image_example': ['example-edge']}
    assert (await save(client, url, doc)).status_code == 200
    return url, doc, files


async def protections(client, file_id):
    data = (await client.get('/files/' + file_id)).json()['data']
    return sorted(row['source_ref'] for row in data['usages'] if row['usage_kind'] == 'canvas_content')


@pytest.mark.asyncio
async def test_shared_fixed_file_keeps_every_usage_and_releases_only_removed_roles(canvas_client):
    client = canvas_client
    url, doc, files = await media_document(client)
    prefix = doc['id'] + ':'
    assert await protections(client, files[0]) == [prefix + part for part in ['design:e', 'image', 'ref']]
    # Another canvas protects the same file independently.
    other = (await client.post('/canvases/p', json={'name': 'other'})).json()['data']
    other_doc = {**other['document'], 'cards': [{'id': 'image', 'type': 'content.image', 'file_id': files[0]}]}
    assert (await save(client, f"/canvases/p/{other['id']}", other_doc)).status_code == 200
    other_ref = other['id'] + ':image'
    doc['cards'][0]['file_id'] = files[1]
    assert (await save(client, url, doc, 1, 'replace-source')).status_code == 200
    reopened = (await client.get(url)).json()['data']['document']
    assert reopened['cards'][1]['image_binding']['file_id'] == files[0]
    assert reopened['cards'][2]['examples'][0]['file_id'] == files[0]
    assert await protections(client, files[0]) == sorted([prefix + 'design:e', prefix + 'ref', other_ref])
    assert (await client.delete('/files/' + files[0])).status_code == 409
    doc['cards'][2]['examples'] = []
    assert (await save(client, url, doc, 2, 'clear-example')).status_code == 200
    assert await protections(client, files[0]) == sorted([prefix + 'ref', other_ref])
    doc['cards'][1]['image_binding'] = None
    assert (await save(client, url, doc, 3, 'clear-reference')).status_code == 200
    assert await protections(client, files[0]) == [other_ref]
    assert (await client.delete(f"/canvases/p/{other['id']}")).status_code == 200
    assert await protections(client, files[0]) == []


@pytest.mark.asyncio
@pytest.mark.parametrize('stage', ['reference', 'example', 'content'])
async def test_save_error_stage_keeps_full_diagnostic_document_revision_and_all_usages(canvas_client, stage):
    client = canvas_client
    url, doc, files = await media_document(client)
    before = (await client.get(url)).json()['data']
    old_protection = await protections(client, files[0])
    doc['name'] = 'must not persist'
    doc['cards'].append({'id': 'bad-content', 'type': 'content.video', 'file_id': 'missing'})
    if stage in ('reference', 'example'):
        doc['cards'][2]['examples'][0]['field_id'] = 'unknown'
    if stage == 'reference':
        doc['cards'][1]['image_binding']['file_id'] = 'missing'
    response = await save(client, url, doc, 1, 'invalid')
    expected = {'reference': ('INVALID_MEDIA_FILE', 'File not found', {'card_id': 'ref'}),
        'example': ('INVALID_EXAMPLE_FIELD', '请选择本卡声明的设计字段', {'card_id': 'design', 'path': ['examples', 'e'], 'field': 'field_id'}),
        'content': ('INVALID_MEDIA_FILE', 'File not found', {'card_id': 'bad-content', 'path': ['file_id']})}[stage]
    assert response.status_code == 422, response.text
    assert response.json()['detail'] == {'code': expected[0], 'severity': 'error', 'message': expected[1], 'target': expected[2], 'blocks': ['save']}
    after = (await client.get(url)).json()['data']
    assert (after['revision'], after['document']) == (before['revision'], before['document'])
    assert await protections(client, files[0]) == old_protection
    # Failed request did not leave a receipt; the same ID can save corrected content.
    assert (await save(client, url, before['document'], 1, 'invalid')).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('withdrawn', [False, True])
async def test_duplicate_example_id_does_not_replace_first_file_check(canvas_client, canvas_file_store, withdrawn):
    from app.models.studio import FileItem
    from app.services.task_service import utcnow
    client = canvas_client
    url, doc, files = await media_document(client)
    # Remove the reference so that example validation is the first file check.
    doc['cards'][1]['image_binding'] = None
    doc['cards'][2]['examples'].append({**deepcopy(doc['cards'][2]['examples'][0]), 'file_id': files[1]})
    if withdrawn:
        async with canvas_file_store['sessions'].begin() as db:
            file = await db.get(FileItem, files[0])
            file.delete_requested_at = utcnow()
    response = await save(client, url, doc, 1, 'duplicate')
    assert response.status_code == 422, response.text
    code, message = ('INVALID_MEDIA_FILE', 'File deleted') if withdrawn else ('INVALID_DESIGN_EXAMPLE', '请选择直接候选中的具体图片、视频或音频示例')
    assert response.json()['detail'] == {'code': code, 'message': message, 'severity': 'error',
        'target': {'card_id': 'design', 'path': ['examples', 'e']}, 'blocks': ['save']}


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', ['foreign', 'type'])
async def test_example_file_errors_keep_specific_target_and_ownership_message(canvas_client, canvas_file_store, invalid):
    from app.models.studio import FileItem
    client = canvas_client
    url, doc, files = await media_document(client)
    if invalid == 'foreign':
        foreign = (await client.post('/files/upload', data={'project_id': 'other', 'usage_kind': 'generation_upload'},
            files={'file': ('foreign.png', b'image', 'image/png')})).json()['data']['id']
        doc['cards'][0]['file_id'] = foreign
        doc['cards'][2]['examples'][0]['file_id'] = foreign
    else:
        doc['cards'][1]['image_binding'] = None
        async with canvas_file_store['sessions'].begin() as db:
            file = await db.get(FileItem, files[0])
            file.type = 'video'
    response = await save(client, url, doc, 1, 'bad-example-file')
    assert response.status_code == 422, response.text
    assert response.json()['detail'] == {'code': 'INVALID_MEDIA_FILE', 'severity': 'error',
        'message': '示例文件不属于当前项目' if invalid == 'foreign' else 'Expected image file',
        'target': {'card_id': 'design', 'path': ['examples', 'e']}, 'blocks': ['save']}


@pytest.mark.asyncio
@pytest.mark.parametrize('stage,code,status', [
    ('revision', 'REVISION_CONFLICT', 409),
    ('schema', 'INVALID_DOCUMENT', 422),
    ('identity', 'INVALID_IDENTITY', 422),
    ('card_identity', 'INVALID_CARD_IDENTITY', 422),
])
async def test_save_early_errors_precede_missing_media_and_leave_request_reusable(canvas_client, stage, code, status):
    client = canvas_client
    url, doc, files = await media_document(client)
    before = (await client.get(url)).json()['data']
    old_protection = await protections(client, files[0])
    doc['cards'].append({'id': 'missing-media', 'type': 'content.image', 'file_id': 'missing'})
    if stage == 'schema':
        doc['cards'].append({'id': 'unknown', 'type': 'unknown'})
    elif stage == 'identity':
        doc['id'] = 'another'
    elif stage == 'card_identity':
        doc['cards'].append(deepcopy(doc['cards'][0]))
    response = await save(client, url, doc, 0 if stage == 'revision' else 1, 'retry')
    assert response.status_code == status, response.text
    assert response.json()['detail']['code'] == code
    after = (await client.get(url)).json()['data']
    assert (after['revision'], after['document']) == (before['revision'], before['document'])
    assert await protections(client, files[0]) == old_protection
    assert (await save(client, url, before['document'], 1, 'retry')).status_code == 200
