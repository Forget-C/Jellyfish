"""Named image references exercised through the saved canvas HTTP contract."""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_reference_selects_identity_without_description_and_without_image(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '命名参考'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc['cards'] = [
        {'id': 'person', 'type': 'content.object', 'object_id': 'alice', 'name': '小雪', 'text': '不能读取的描述'},
        {'id': 'ref', 'type': 'reference.character', 'title': '角色图', 'input_bindings': [
            {'id': 'name', 'source': {'canvas_id': canvas['id'], 'card_id': 'person', 'port_id': 'object', 'position': 0, 'object_id': 'alice'}, 'input_port': 'name'}]}]
    doc['edges'] = [{'id': 'name', 'source_card': 'person', 'source_port': 'object', 'target_card': 'ref', 'target_port': 'name'}]
    doc['input_order'] = {'ref': {'name': ['name']}}
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    output = (await client.get(url + '/cards/ref/outputs')).json()['data']
    assert [item['payload'] for item in output['candidates']] == [
        {'kind': 'object_reference', 'object_id': 'alice', 'name': '小雪', 'category': 'character'}]
    assert len(output['outputs']) == 1
    assert output['outputs'][0]['payload'] == output['candidates'][0]['payload']
    assert output['outputs'][0]['source']['object_id'] == 'alice'
    reopened = (await client.get(url)).json()['data']['document']['cards'][1]
    assert reopened['angle'] == '正面'
    removed = {**doc, 'cards': doc['cards'][1:], 'edges': [], 'input_order': {}}
    rejected = await client.put(url, json={'request_id': 'delete', 'expected_revision': 1, 'document': removed})
    assert rejected.status_code == 422
    assert rejected.json()['detail']['code'] == 'REFERENCE_IN_USE'


@pytest.mark.asyncio
async def test_image_mapping_tracks_selected_object_across_reorder_and_compiles_once(canvas_client):
    client = canvas_client
    uploaded = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'},
        files={'file': ('ref.png', b'picture', 'image/png')})).json()['data']
    canvas = (await client.post('/canvases/p', json={'name': '映射'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc['cards'] = [
        {'id': 'group', 'type': 'reference.character', 'objects': [
            {'object_id': 'alice', 'name': '小雪', 'category': 'character', 'position': '左侧'},
            {'object_id': 'bob', 'name': '小李', 'category': 'character', 'position': '右侧'}],
         'image_binding': {'file_id': uploaded['id']}},
        {'id': 'detail', 'type': 'reference.character', 'input_bindings': [
            {'id': 'bob', 'source': {'canvas_id': canvas['id'], 'card_id': 'group', 'port_id': 'object', 'position': 0, 'object_id': 'bob'}, 'input_port': 'name'}]},
        {'id': 'image', 'type': 'model.image', 'model_id': 'canvas-image', 'prompt': {'segments': [{'id': 'literal', 'kind': 'text', 'text': '原样保留持有描述'}]},
         'input_bindings': [{'id': 'image', 'source': {'canvas_id': canvas['id'], 'card_id': 'group', 'port_id': 'image', 'position': 0}, 'input_port': 'image'}]}]
    doc['edges'] = [
        {'id': 'name', 'source_card': 'group', 'source_port': 'object', 'target_card': 'detail', 'target_port': 'name'},
        {'id': 'image', 'source_card': 'group', 'source_port': 'image', 'target_card': 'image', 'target_port': 'image'}]
    doc['input_order'] = {'detail': {'name': ['name']}, 'image': {'image': ['image']}}
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await client.get(url + '/cards/image/compile')).json()['data']
    assert compiled['text'] == '原样保留持有描述\n小雪 = image 1（正面，左侧）\n小李 = image 1（正面，右侧）'
    assert len(compiled['media']) == 1
    doc['cards'][0]['objects'].reverse()
    assert (await client.put(url, json={'request_id': 'reorder', 'expected_revision': 1, 'document': doc})).status_code == 200
    output = (await client.get(url + '/cards/detail/outputs')).json()['data']['outputs']
    assert len(output) == 1 and output[0]['payload']['object_id'] == 'bob'
    assert output[0]['payload']['name'] == '小李'
    reopened = (await client.get(url)).json()['data']['document']['cards'][2]
    assert reopened['prompt']['segments'] == [{'id': 'literal', 'kind': 'text', 'text': '原样保留持有描述'}]


@pytest.mark.asyncio
async def test_reference_rejects_ambiguous_object_and_unbound_fixed_source(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '明确对象'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'id': 'source', 'type': 'reference.character', 'objects': [
        {'object_id': 'a', 'name': '甲', 'category': 'character'},
        {'object_id': 'b', 'name': '乙', 'category': 'character'}]}
    target = {'id': 'target', 'type': 'reference.character', 'input_bindings': [
        {'id': 'ambiguous', 'source': {'canvas_id': canvas['id'], 'card_id': 'source', 'port_id': 'object', 'position': 0}, 'input_port': 'name'}]}
    doc['cards'] = [source, target]
    doc['edges'] = [{'id': 'e', 'source_card': 'source', 'source_port': 'object', 'target_card': 'target', 'target_port': 'name'}]
    doc['input_order'] = {'target': {'name': ['e']}}
    rejected = await client.put(url, json={'request_id': 'ambiguous', 'expected_revision': 0, 'document': doc})
    assert rejected.status_code == 422 and rejected.json()['detail']['code'] == 'INVALID_NAME_BINDING'
    target['input_bindings'][0]['source']['object_id'] = 'a'
    saved = await client.put(url, json={'request_id': 'specific', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    source['objects'] = source['objects'][1:]
    # Removing an adopted object cannot silently select its neighbour.
    output_save = await client.put(url, json={'request_id': 'remove-object', 'expected_revision': 1, 'document': doc})
    assert output_save.status_code == 422
    assert output_save.json()['detail']['code'] == 'INVALID_NAME_BINDING'


@pytest.mark.asyncio
async def test_empty_named_reference_cannot_publish_image_until_main_category_is_named(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '未完成参考'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    uploaded = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('ref.png', b'picture', 'image/png')})).json()['data']
    doc = canvas['document']
    doc['cards'] = [{'id': 'ref', 'type': 'reference.character', 'image_binding': {'file_id': uploaded['id']}, 'objects': [
        {'object_id': 'empty', 'name': '', 'category': 'character'}, {'object_id': 'coat', 'name': '蓝衣', 'category': 'costume'}]}]
    saved = await client.put(url, json={'request_id': 'empty', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    outputs = (await client.get(url + '/cards/ref/outputs')).json()['data']['outputs']
    assert [item['source']['port_id'] for item in outputs] == ['object']
    assert outputs[0]['payload']['object_id'] == 'coat'


@pytest.mark.asyncio
async def test_independent_reference_identity_must_be_nonempty(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '身份'})).json()['data']
    doc = canvas['document']
    doc['cards'] = [{'id': 'ref', 'type': 'reference.prop', 'objects': [{'object_id': '', 'name': '剑', 'category': 'prop'}]}]
    response = await client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'bad', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,category', [('character', 'character'), ('place', 'place'), ('prop', 'prop'), ('costume', 'costume')])
async def test_four_categories_and_fixed_file_source_remain_explicit(canvas_client, kind, category):
    client = canvas_client
    files = []
    for index in range(2):
        files.append((await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': (f'{index}.png', b'picture', 'image/png')})).json()['data']['id'])
    canvas = (await client.post('/canvases/p', json={'name': kind})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    image = {'file_id': files[0], 'source': {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}}
    doc['cards'] = [{'id': 'image', 'type': 'content.image', 'file_id': files[0]},
        {'id': 'ref', 'type': 'reference.' + kind, 'objects': [{'object_id': 'one', 'name': '主对象', 'category': category}], 'image_binding': image}]
    doc['edges'] = [{'id': 'e', 'source_card': 'image', 'source_port': 'image', 'target_card': 'ref', 'target_port': 'image_source'}]
    doc['input_order'] = {'ref': {'image_source': ['e']}}
    saved = await client.put(url, json={'request_id': 'initial', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    doc['cards'][0]['file_id'] = files[1]
    assert (await client.put(url, json={'request_id': 'replace-source', 'expected_revision': 1, 'document': doc})).status_code == 200
    outputs = (await client.get(url + '/cards/ref/outputs')).json()['data']['outputs']
    assert outputs[0]['file_id'] == files[0]
    removed = {**doc, 'cards': doc['cards'][1:], 'edges': [], 'input_order': {}}
    response = await client.put(url, json={'request_id': 'remove-source', 'expected_revision': 2, 'document': removed})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'REFERENCE_IN_USE'
    # Explicitly rebinding the same concrete file as an independent project file releases the edge.
    removed['cards'][0]['image_binding'] = {'file_id': files[0]}
    assert (await client.put(url, json={'request_id': 'detach', 'expected_revision': 2, 'document': removed})).status_code == 200
    removed['cards'][0]['objects'][0]['category'] = 'place' if category != 'place' else 'character'
    invalid = await client.put(url, json={'request_id': 'wrong-category', 'expected_revision': 3, 'document': removed})
    assert invalid.status_code == 422 and invalid.json()['detail']['code'] == 'INVALID_REFERENCE_CATEGORY'


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
async def test_name_and_image_candidate_edges_share_cycle_detection(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '统一无环'})).json()['data']
    doc = canvas['document']
    doc.update(cards=[{'id': 'a', 'type': 'reference.character'}, {'id': 'b', 'type': 'reference.character'}],
        edges=[{'id': 'name', 'source_card': 'a', 'source_port': 'object', 'target_card': 'b', 'target_port': 'name'},
               {'id': 'image', 'source_card': 'b', 'source_port': 'image', 'target_card': 'a', 'target_port': 'image_source'}],
        input_order={'b': {'name': ['name']}, 'a': {'image_source': ['image']}})
    result = await client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'cycle', 'expected_revision': 0, 'document': doc})
    assert result.status_code == 422 and result.json()['detail']['code'] == 'GRAPH_CYCLE'


@pytest.mark.asyncio
async def test_role_optional_names_do_not_block_independent_character_but_costume_rejects_person(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '角色可选要素'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    src = {'canvas_id': canvas['id'], 'card_id': 'costume', 'port_id': 'object', 'position': 0, 'object_id': 'coat'}
    doc.update(cards=[{'id': 'costume', 'type': 'content.object', 'object_id': 'coat', 'name': '蓝衣', 'category': 'costume'},
        {'id': 'ref', 'type': 'reference.character', 'objects': [{'object_id': 'alice', 'name': '小雪', 'category': 'character'}],
         'input_bindings': [{'id': 'optional', 'input_port': 'name', 'source': src}]}],
        edges=[{'id': 'e', 'source_card': 'costume', 'source_port': 'object', 'target_card': 'ref', 'target_port': 'name'}], input_order={'ref': {'name': ['e']}})
    assert (await client.put(url, json={'request_id': 'optional', 'expected_revision': 0, 'document': doc})).status_code == 200
    doc['cards'][0]['category'] = 'character'
    invalid = await client.put(url, json={'request_id': 'primary-bound', 'expected_revision': 1, 'document': doc})
    assert invalid.status_code == 422 and invalid.json()['detail']['code'] == 'BOUND_OBJECT_OWNED_UPSTREAM'
    doc['cards'][1]['type'] = 'reference.costume'
    # Test a fresh card identity because card types themselves are immutable.
    doc['cards'][1]['id'] = 'costume-ref'; doc['cards'][1]['objects'] = []
    doc['edges'][0]['target_card'] = 'costume-ref'; doc['input_order'] = {'costume-ref': {'name': ['e']}}
    invalid = await client.put(url, json={'request_id': 'wearer', 'expected_revision': 1, 'document': doc})
    assert invalid.status_code == 422 and invalid.json()['detail']['code'] == 'INVALID_REFERENCE_CATEGORY'


@pytest.mark.asyncio
async def test_direct_name_binding_owns_identity_and_rejects_category_change(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '直接身份'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    owner = {'id': 'owner', 'type': 'content.object', 'object_id': 'sword', 'name': '长剑', 'category': 'prop'}
    reference = {'id': 'ref', 'type': 'reference.prop', 'objects': [{'object_id': 'sword', 'name': '另一把剑', 'category': 'prop'}]}
    doc['cards'] = [owner, reference]
    rejected = await client.put(url, json={'request_id': 'borrow-id', 'expected_revision': 0, 'document': doc})
    assert rejected.status_code == 422 and rejected.json()['detail']['code'] == 'DUPLICATE_OBJECT_IDENTITY'
    reference['objects'] = []
    reference['input_bindings'] = [{'id': 'name', 'input_port': 'name', 'source': {'canvas_id': canvas['id'], 'card_id': 'owner', 'port_id': 'object', 'position': 0, 'object_id': 'sword'}}]
    doc.update(edges=[{'id': 'e', 'source_card': 'owner', 'source_port': 'object', 'target_card': 'ref', 'target_port': 'name'}], input_order={'ref': {'name': ['e']}})
    assert (await client.put(url, json={'request_id': 'bind', 'expected_revision': 0, 'document': doc})).status_code == 200
    owner['category'] = 'costume'
    rejected = await client.put(url, json={'request_id': 'category', 'expected_revision': 1, 'document': doc})
    assert rejected.status_code == 422
    assert rejected.json()['detail']['code'] == 'INVALID_REFERENCE_CATEGORY'
    assert rejected.json()['detail']['target']['card_id'] == 'ref'


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
        {'id': 'front', 'type': 'reference.character', 'objects': [{'object_id': 'alice', 'name': '小雪', 'category': 'character'}], 'image_binding': {'file_id': files[0]}},
        {'id': 'side', 'type': 'reference.character', 'title': '侧面', 'angle': '侧面', 'input_bindings': [{'id': 'name', 'input_port': 'name', 'source': source('front', 'object', 'alice')}], 'image_binding': {'file_id': files[1]}},
        {'id': 'v', 'type': 'model.video', 'prompt': {'segments': [{'id': 'text', 'kind': 'text', 'text': '自由正文说背面，不纠错'}]}, 'input_bindings': [
            {'id': 'first', 'input_port': 'first_frame', 'source': source('front')},
            {'id': 'subject-front', 'input_port': 'subject_image', 'subject_name': '人物组', 'source': source('front')},
            {'id': 'subject-side', 'input_port': 'subject_image', 'subject_name': '人物组', 'source': source('side')}]}],
        edges=[{'id': 'name', 'source_card': 'front', 'source_port': 'object', 'target_card': 'side', 'target_port': 'name'}] + [
            {'id': card + port, 'source_card': card, 'source_port': 'image', 'target_card': 'v', 'target_port': port} for card, port in [('front', 'first_frame'), ('front', 'subject_image'), ('side', 'subject_image')]],
        input_order={'side': {'name': ['name']}, 'v': {'first_frame': ['frontfirst_frame'], 'subject_image': ['frontsubject_image', 'sidesubject_image']}})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await client.get(url + '/cards/v/compile')).json()['data']
    assert compiled['text'] == '自由正文说背面，不纠错\n小雪 = 首帧（正面）\n小雪 = @人物组 图片 1（正面）\n小雪 = @人物组 图片 2（侧面）'
    mappings = [item for item in compiled['mapping'] if 'object_id' in item]
    assert [(item['object_id'], item['media_position'], item['input_port'], item.get('subject_name')) for item in mappings] == [
        ('alice', 1, 'first_frame', None), ('alice', 1, 'subject_image', '人物组'), ('alice', 2, 'subject_image', '人物组')]
    assert len(compiled['video_media']['subjects']) == 1
    assert [item['file_id'] for item in compiled['video_media']['subjects'][0]['media']] == files
    doc['cards'][-1]['input_bindings'] = doc['cards'][-1]['input_bindings'][:1]
    assert (await client.put(url, json={'request_id': 'cancel', 'expected_revision': 1, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/v/compile')).json()['data']
    assert compiled['video_media']['subjects'] == []
    assert compiled['text'] == '自由正文说背面，不纠错\n小雪 = 首帧（正面）'
    doc['cards'].append({'id': 'image', 'type': 'model.image', 'model_id': 'canvas-image', 'input_bindings': [
        {'id': name, 'input_port': 'image', 'source': source(name)} for name in ['front', 'side']]})
    doc['edges'].extend({'id': name + '-image', 'source_card': name, 'source_port': 'image', 'target_card': 'image', 'target_port': 'image'} for name in ['front', 'side'])
    doc['input_order']['image'] = {'image': ['front-image', 'side-image']}
    assert (await client.put(url, json={'request_id': 'image-angles', 'expected_revision': 2, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/image/compile')).json()['data']
    assert compiled['can_run'] and len(compiled['media']) == 2, compiled['diagnostics']
    assert compiled['text'] == '小雪 = image 1（正面）\n小雪 = image 2（侧面）'
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
    assert compiled['text'] == 'front = @人物组 图片 2（正面）\nside = @人物组 图片 1（正面）'
    assert [(entry['object_id'], entry['purpose_position']) for entry in compiled['mapping'] if 'object_id' in entry] == [('front', 2), ('side', 1)]
