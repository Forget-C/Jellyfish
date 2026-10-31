"""Single-object reference cards exercised through the saved canvas HTTP contract."""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_reference_name_drafts_and_unique_scope(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '参考名称'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    doc['cards'] = [{'id': 'a', 'type': 'reference.character', 'name': ' '},
                    {'id': 'b', 'type': 'reference.character', 'name': '小雪'},
                    {'id': 'c', 'type': 'reference.costume', 'name': '小雪'}]
    async def save(revision):
        result = await client.put(url, json={'request_id': str(revision), 'expected_revision': revision, 'document': doc})
        assert result.status_code == 200, result.text
    async def outputs(card):
        return (await client.get(url + f'/cards/{card}/outputs')).json()['data']['outputs']
    await save(0)
    assert not await outputs('a')
    assert len(await outputs('b')) == len(await outputs('c')) == 1
    doc['cards'][0]['name'] = ' 小雪 '
    await save(1)
    assert not await outputs('a') and not await outputs('b')
    assert len(await outputs('c')) == 1
    doc['cards'][0]['name'] = '小李'
    await save(2)
    assert (await outputs('a'))[0]['payload']['name'] == '小李'
    doc['cards'][0]['object_id'] = 'new-identity'
    rejected = await client.put(url, json={'request_id': 'identity', 'expected_revision': 3, 'document': doc})
    assert rejected.status_code == 422 and rejected.json()['detail']['code'] == 'IMMUTABLE_OBJECT_IDENTITY'


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['character', 'place', 'prop', 'costume'])
async def test_four_categories_fixed_image_requires_connection_and_can_detach(canvas_client, kind):
    client = canvas_client
    files = [(await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'},
        files={'file': (f'{index}.png', b'image', 'image/png')})).json()['data']['id'] for index in range(2)]
    canvas = (await client.post('/canvases/p', json={'name': kind})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    doc['cards'] = [{'id': 'image', 'type': 'content.image', 'file_id': files[0]},
        {'id': 'ref', 'type': 'reference.' + kind, 'name': '主对象', 'image_binding': {'file_id': files[0],
         'source': {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}}}]
    response = await client.put(url, json={'request_id': 'unconnected', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422
    doc.update(edges=[{'id': 'e', 'source_card': 'image', 'source_port': 'image', 'target_card': 'ref', 'target_port': 'image_source'}], input_order={'ref': {'image_source': ['e']}})
    response = await client.put(url, json={'request_id': 'connected', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    doc['cards'][0]['file_id'] = files[1]
    assert (await client.put(url, json={'request_id': 'replace', 'expected_revision': 1, 'document': doc})).status_code == 200
    output = (await client.get(url + '/cards/ref/outputs')).json()['data']['outputs']
    assert output[0]['file_id'] == files[0]
    assert output[0]['payload']['objects'] == [{'object_id': 'ref', 'name': '主对象', 'category': kind, 'position': ''}]
    doc.update(cards=doc['cards'][1:], edges=[], input_order={})
    rejected = await client.put(url, json={'request_id': 'remove', 'expected_revision': 2, 'document': doc})
    assert rejected.status_code == 422 and rejected.json()['detail']['code'] == 'REFERENCE_IN_USE'
    doc['cards'][0]['image_binding'] = {'file_id': files[0]}
    assert (await client.put(url, json={'request_id': 'detach', 'expected_revision': 2, 'document': doc})).status_code == 200


@pytest.mark.asyncio
async def test_reference_category_and_image_cycle_are_validated(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '图约束'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    doc.update(cards=[{'id': 'a', 'type': 'reference.character', 'name': '甲'}, {'id': 'b', 'type': 'reference.prop', 'name': '乙'}],
        edges=[{'id': 'e', 'source_card': 'a', 'source_port': 'image', 'target_card': 'b', 'target_port': 'image_source'}], input_order={'b': {'image_source': ['e']}})
    response = await client.put(url, json={'request_id': 'category', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'INVALID_REFERENCE_CATEGORY'
    doc['cards'][1]['type'] = 'reference.character'
    doc['edges'].append({'id': 'back', 'source_card': 'b', 'source_port': 'image', 'target_card': 'a', 'target_port': 'image_source'})
    doc['input_order']['a'] = {'image_source': ['back']}
    response = await client.put(url, json={'request_id': 'cycle', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'GRAPH_CYCLE'


@pytest.mark.asyncio
async def test_reference_file_withdrawal_invalidates_image_but_keeps_object(canvas_client, canvas_file_store):
    from app.models.studio import FileItem
    from app.services.task_service import utcnow
    client = canvas_client
    uploaded = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('ref.png', b'picture', 'image/png')})).json()['data']
    canvas = (await client.post('/canvases/p', json={'name': '撤回图片'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'ref', 'port_id': 'image', 'position': 0}
    doc = canvas['document']
    doc.update(cards=[{'id': 'ref', 'type': 'reference.place', 'objects': [{'object_id': 'room', 'name': '空屋', 'category': 'place'}], 'image_binding': {'file_id': uploaded['id']}},
        {'id': 'model', 'type': 'model.image', 'input_bindings': [{'id': 'ref-input', 'input_port': 'image', 'source': source}]}],
        edges=[{'id': 'e', 'source_card': 'ref', 'source_port': 'image', 'target_card': 'model', 'target_port': 'image'}], input_order={'model': {'image': ['e']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    async with canvas_file_store['sessions'].begin() as db:
        file = await db.get(FileItem, uploaded['id'])
        file.delete_requested_at = utcnow()
    outputs = (await client.get(url + '/cards/ref/outputs')).json()['data']['outputs']
    assert not outputs[0]['available'] and outputs[0]['payload'] is None
    assert outputs[1]['payload']['object_id'] == 'room'
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert not compiled['can_run'] and compiled['media'] == []
    assert 'OUTPUT_MISSING' in [item['code'] for item in compiled['diagnostics']]


@pytest.mark.asyncio
async def test_video_multiple_angles_map_actual_purposes_and_explicit_group(canvas_client):
    client = canvas_client
    files = [(await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'},
        files={'file': (name + '.png', b'image', 'image/png')})).json()['data']['id'] for name in ['front', 'side']]
    canvas = (await client.post('/canvases/p', json={'name': '多角度'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    def source(card, port='image', object_id=None):
        value = {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0}
        if object_id:
            value['object_id'] = object_id
        return value
    doc = canvas['document']
    doc.update(cards=[
        {'id': 'front', 'type': 'reference.character', 'name': '小雪正面', 'object_id': 'alice', 'image_binding': {'file_id': files[0]}},
        {'id': 'side', 'type': 'reference.character', 'name': '小雪侧面', 'object_id': 'alice', 'angle': '侧面', 'image_binding': {'file_id': files[1]}},
        {'id': 'v', 'type': 'model.video', 'prompt': {'segments': [{'id': 'text', 'kind': 'text', 'text': '自由正文说背面，不纠错'}]}, 'input_bindings': [
            {'id': 'first', 'input_port': 'first_frame', 'source': source('front')},
            {'id': 'subject-front', 'input_port': 'subject_image', 'subject_name': '人物组', 'source': source('front')},
            {'id': 'subject-side', 'input_port': 'subject_image', 'subject_name': '人物组', 'source': source('side')}]}],
        edges=[
            {'id': card + port, 'source_card': card, 'source_port': 'image', 'target_card': 'v', 'target_port': port} for card, port in [('front', 'first_frame'), ('front', 'subject_image'), ('side', 'subject_image')]],
        input_order={'v': {'first_frame': ['frontfirst_frame'], 'subject_image': ['frontsubject_image', 'sidesubject_image']}})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await client.get(url + '/cards/v/compile')).json()['data']
    assert compiled['text'] == '自由正文说背面，不纠错\n人物·小雪正面 = 首帧（正面）\n人物·小雪正面 = @人物组 图片 1（正面）\n人物·小雪侧面 = @人物组 图片 2（侧面）'
    mappings = [item for item in compiled['mapping'] if 'object_id' in item]
    assert [(item['object_id'], item['media_position'], item['input_port'], item.get('subject_name')) for item in mappings] == [
        ('alice', 1, 'first_frame', None), ('alice', 1, 'subject_image', '人物组'), ('alice', 2, 'subject_image', '人物组')]
    assert len(compiled['video_media']['subjects']) == 1
    assert [item['file_id'] for item in compiled['video_media']['subjects'][0]['media']] == files
    doc['cards'][-1]['input_bindings'] = doc['cards'][-1]['input_bindings'][:1]
    assert (await client.put(url, json={'request_id': 'cancel', 'expected_revision': 1, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/v/compile')).json()['data']
    assert compiled['video_media']['subjects'] == []
    assert compiled['text'] == '自由正文说背面，不纠错\n人物·小雪正面 = 首帧（正面）'
    doc['cards'].append({'id': 'image', 'type': 'model.image', 'model_id': 'canvas-image', 'input_bindings': [
        {'id': name, 'input_port': 'image', 'source': source(name)} for name in ['front', 'side']]})
    doc['edges'].extend({'id': name + '-image', 'source_card': name, 'source_port': 'image', 'target_card': 'image', 'target_port': 'image'} for name in ['front', 'side'])
    doc['input_order']['image'] = {'image': ['front-image', 'side-image']}
    assert (await client.put(url, json={'request_id': 'image-angles', 'expected_revision': 2, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/image/compile')).json()['data']
    assert compiled['can_run'] and len(compiled['media']) == 2, compiled['diagnostics']
    assert compiled['text'] == '人物·小雪正面 = image 1（正面）\n人物·小雪侧面 = image 2（侧面）'
    assert [item['object_id'] for item in compiled['mapping'] if 'object_id' in item] == ['alice', 'alice']


@pytest.mark.asyncio
async def test_subject_mapping_uses_group_image_order_instead_of_candidate_order(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '顺序'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    files = [(await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'},
        files={'file': (name + '.png', b'image', 'image/png')})).json()['data']['id'] for name in ['front', 'side']]
    doc = canvas['document']
    doc.update(cards=[{'id': name, 'type': 'reference.character', 'objects': [{'object_id': name, 'name': name, 'category': 'character'}],
        'image_binding': {'file_id': file}} for name, file in zip(['front', 'side'], files)] + [
        {'id': 'v', 'type': 'model.video', 'input_bindings': [
            {'id': name, 'input_port': 'subject_image', 'subject_name': '人物组', 'source': {'canvas_id': canvas['id'], 'card_id': name, 'port_id': 'image', 'position': 0}} for name in ['side', 'front']]}],
        edges=[{'id': name, 'source_card': name, 'source_port': 'image', 'target_card': 'v', 'target_port': 'subject_image'} for name in ['front', 'side']],
        input_order={'v': {'subject_image': ['front', 'side']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/v/compile')).json()['data']
    assert [ref['file_id'] for ref in compiled['video_media']['subjects'][0]['media']] == files[::-1]
    assert compiled['text'] == '人物·front = @人物组 图片 2（正面）\n人物·side = @人物组 图片 1（正面）'
    assert [(entry['object_id'], entry['purpose_position']) for entry in compiled['mapping'] if 'object_id' in entry] == [('front', 2), ('side', 1)]
