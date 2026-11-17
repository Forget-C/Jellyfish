"""Reference saves use the final document while retaining fixed files and diagnostics."""
from tests.canvas_urls import canvas_url, seed_scene_canvas
from copy import deepcopy
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


async def reference_document(client):
    files = [(await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'},
        files={'file': (f'{index}.png', b'image', 'image/png')})).json()['data']['id'] for index in range(2)]
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': 'reference save'})).json()['data']
    document = canvas['document']
    document.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': files[0]},
        {'id': 'ref', 'type': 'reference.character', 'name': '人物', 'image_binding': {'file_id': files[0],
            'source': {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}}}],
        edges=[{'id': 'edge', 'source_card': 'image', 'source_port': 'image', 'target_card': 'ref', 'target_port': 'image_source'}],
        input_order={'ref': {'image_source': ['edge']}})
    return canvas_url(f"/canvases/p/{canvas['id']}"), document, files


async def save(client, url, document, revision=0, request_id='save'):
    return await client.put(url, json={'request_id': request_id, 'expected_revision': revision, 'document': document})


@pytest.mark.asyncio
async def test_reference_can_select_replaced_source_file_in_same_save(canvas_client):
    client = canvas_client
    url, document, files = await reference_document(client)
    assert (await save(client, url, document)).status_code == 200
    document['cards'][0]['file_id'] = files[1]
    document['cards'][1]['image_binding']['file_id'] = files[1]
    response = await save(client, url, document, 1, 'replace-both')
    assert response.status_code == 200, response.text
    saved = (await client.get(url)).json()['data']
    assert saved['document']['cards'][1]['image_binding']['file_id'] == files[1]
    outputs = (await client.get(url + '/cards/ref/outputs')).json()['data']['outputs']
    assert outputs[0]['file_id'] == files[1]


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', ['canvas_id', 'card_id', 'position', 'result_set_id', 'file_id'])
async def test_reference_rejects_forged_binding_without_changing_saved_state(canvas_client, invalid):
    client = canvas_client
    url, document, files = await reference_document(client)
    assert (await save(client, url, document)).status_code == 200
    changed = deepcopy(document)
    binding = changed['cards'][1]['image_binding']
    if invalid == 'file_id':
        binding['file_id'] = files[1]
    elif invalid == 'result_set_id':
        binding['result_set_id'] = 'other-result'
    else:
        binding['source'][invalid] = 1 if invalid == 'position' else 'other'
    response = await save(client, url, changed, 1, 'invalid')
    expected = ('INVALID_REFERENCE_SOURCE', '新增参考图仅可从图片内容卡选择', {'card_id': 'ref', 'path': ['image_binding']}) if invalid == 'card_id' else (
        'INVALID_IMAGE_BINDING', '请选择已发布的具体图片产物', {'card_id': 'ref'})
    assert response.status_code == 422, response.text
    assert response.json()['detail'] == {'code': expected[0], 'severity': 'error', 'message': expected[1], 'target': expected[2], 'blocks': ['save']}
    saved = (await client.get(url)).json()['data']
    assert saved['revision'] == 1 and saved['document']['cards'][1]['image_binding']['file_id'] == files[0]
    usages = (await client.get('/files/' + files[0])).json()['data']['usages']
    assert any(item['usage_kind'] == 'canvas_content' and item['source_ref'].endswith(':ref') for item in usages)


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid,message', [
    ('missing', 'File not found'), ('foreign', '文件不属于当前项目'),
    ('type', 'Expected image file'), ('withdrawn', 'File deleted'),
])
async def test_reference_file_errors_precede_candidate_mismatch(canvas_client, canvas_file_store, invalid, message):
    from app.models.studio import FileItem
    from app.services.task_service import utcnow
    client = canvas_client
    url, document, files = await reference_document(client)
    assert (await save(client, url, document)).status_code == 200
    file_id = files[1]
    if invalid == 'missing':
        file_id = 'missing'
    elif invalid == 'foreign':
        file_id = (await client.post('/files/upload', data={'project_id': 'other', 'usage_kind': 'generation_upload'},
            files={'file': ('foreign.png', b'image', 'image/png')})).json()['data']['id']
    else:
        async with canvas_file_store['sessions'].begin() as db:
            file = await db.get(FileItem, file_id)
            if invalid == 'type':
                file.type = 'video'
            else:
                file.delete_requested_at = utcnow()
    document['cards'][1]['image_binding'].update(file_id=file_id, result_set_id='also-invalid')
    response = await save(client, url, document, 1, 'bad-file')
    assert response.status_code == 422, response.text
    assert response.json()['detail'] == {'code': 'INVALID_MEDIA_FILE', 'severity': 'error', 'message': message,
        'target': {'card_id': 'ref'}, 'blocks': ['save']}
    saved = (await client.get(url)).json()['data']
    assert saved['revision'] == 1 and saved['document']['cards'][1]['image_binding']['file_id'] == files[0]
    usages = (await client.get('/files/' + files[0])).json()['data']['usages']
    assert any(item['usage_kind'] == 'canvas_content' and item['source_ref'].endswith(':ref') for item in usages)


@pytest.mark.asyncio
async def test_reference_identity_error_precedes_invalid_file(canvas_client):
    client = canvas_client
    url, document, _ = await reference_document(client)
    assert (await save(client, url, document)).status_code == 200
    document['cards'][1].update(object_id='new-object', image_binding={'file_id': 'missing'})
    response = await save(client, url, document, 1, 'two-errors')
    assert response.status_code == 422
    assert response.json()['detail'] == {'code': 'IMMUTABLE_OBJECT_IDENTITY', 'severity': 'error',
        'message': '已建立参考对象的身份不可修改', 'target': {'card_id': 'ref'}, 'blocks': ['save']}


@pytest.mark.asyncio
async def test_reference_save_with_unrelated_published_model_and_changed_configuration(canvas_client, canvas_file_store):
    from app.models.llm import Model, Provider
    from app.services.task_service import TaskService
    client = canvas_client
    url, document, files = await reference_document(client)
    document['cards'].append({'id': 'model', 'type': 'model.text', 'model_id': 'canvas-text',
        'prompt': {'segments': [{'id': 'body', 'kind': 'text', 'text': 'Unrelated request'}]}})
    async with canvas_file_store['sessions'].begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'private-secret'
    assert (await save(client, url, document)).status_code == 200
    preview = (await client.post(url + '/precheck', json={'card_id': 'model'})).json()['data']
    assert preview['can_run'], preview
    response = await client.post(url + '/runs', json={'request_id': 'model-run', 'preview_token': preview['preview_token']})
    assert response.status_code == 200, response.text
    accepted = response.json()['data']
    async with canvas_file_store['sessions'].begin() as db:
        service = TaskService(db)
        await service.claim(accepted['task_ids'][0], worker_id='test')
        await service.finish(accepted['task_ids'][0], result={'text': 'Unrelated result'})
    state = (await client.get(url + '/runtime')).json()['data']
    assert state['current_outputs']['model'][0]['text'] == 'Unrelated result'
    async with canvas_file_store['sessions'].begin() as db:
        model = await db.get(Model, 'canvas-text')
        model.name, model.params = 'changed-model', {'temperature': .9}
        provider = await db.get(Provider, 'canvas-provider')
        provider.base_url, provider.api_key = 'https://changed.test', 'changed-secret'
    document['cards'][0]['file_id'] = files[1]
    document['cards'][1]['image_binding']['file_id'] = files[1]
    response = await save(client, url, document, 1, 'reference-after-model-change')
    assert response.status_code == 200, response.text
    outputs = (await client.get(url + '/cards/ref/outputs')).json()['data']['outputs']
    assert outputs[0]['file_id'] == files[1]
    state = (await client.get(url + '/runtime')).json()['data']
    assert len(state['runs']) == 1 and not state['current_outputs']['model'][0]['basis_current']
