"""人物、物件和场所经画布 HTTP 保存并发布明确出口。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401
from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401


@pytest.mark.asyncio
async def test_description_and_object_reference_are_separate_outputs(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '对象'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document['cards'] = [{'id': 'person', 'type': 'content.object', 'object_id': 'zhang-san',
                          'name': '张三', 'category': 'character', 'text': '红衣，沉默。', 'source_locator': '手稿第2页'}]
    saved = await client.put(url, json={'request_id': 'objects', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    reopened = (await client.get(url)).json()['data']['document']['cards'][0]
    assert reopened['object_id'] == 'zhang-san'
    assert reopened['source_locator'] == '手稿第2页'
    outputs = (await client.get(url + '/cards/person/outputs')).json()['data']['outputs']
    assert [(item['source']['port_id'], item['payload']) for item in outputs] == [
        ('text', {'kind': 'description', 'text': '红衣，沉默。', 'name': '张三', 'object_id': 'zhang-san', 'category': 'character', 'source_locator': '手稿第2页'}),
        ('object', {'kind': 'object_reference', 'object_id': 'zhang-san', 'name': '张三', 'category': 'character'})]


@pytest.mark.asyncio
async def test_names_are_unique_per_canvas_and_saved_object_identity_is_stable(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '唯一名称'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    first = {'id': 'person', 'type': 'content.object', 'object_id': 'person-one', 'name': '张三', 'category': 'character', 'text': ''}
    document['cards'] = [first]
    assert (await client.put(url, json={'request_id': 'initial', 'expected_revision': 0, 'document': document})).status_code == 200
    duplicate = {**first, 'id': 'copy', 'object_id': 'person-two', 'name': ' 张三 '}
    bad = await client.put(url, json={'request_id': 'copy', 'expected_revision': 1, 'document': {**document, 'cards': [first, duplicate]}})
    assert bad.status_code == 422
    assert bad.json()['detail']['code'] == 'DUPLICATE_OBJECT_NAME'
    changed = await client.put(url, json={'request_id': 'identity', 'expected_revision': 1, 'document': {**document, 'cards': [{**first, 'object_id': 'different'}]}})
    assert changed.status_code == 422
    assert changed.json()['detail']['code'] == 'IMMUTABLE_OBJECT_IDENTITY'
    other = (await client.post('/canvases/p', json={'name': '另一画布'})).json()['data']
    assert (await client.put(f"/canvases/p/{other['id']}", json={'request_id': 'same-name', 'expected_revision': 0, 'document': {**other['document'], 'cards': [first]}})).status_code == 200


@pytest.mark.asyncio
async def test_incomplete_objects_publish_only_literal_description_and_models_adopt_text(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '正文采用'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc['cards'] = [{'id': 'place', 'type': 'content.place', 'name': '', 'text': '空屋里有张三', 'category': 'place'},
                    {'id': 'model', 'type': 'model.text', 'prompt': {'segments': [{'id': 'r', 'kind': 'reference', 'source': {'canvas_id': canvas['id'], 'card_id': 'place', 'port_id': 'text', 'position': 0}}]}}]
    doc['edges'] = [{'id': 'edge', 'source_card': 'place', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}]
    doc['input_order'] = {'model': {'text': ['edge']}}
    saved = await client.put(url, json={'request_id': 'incomplete', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    outputs = (await client.get(url + '/cards/place/outputs')).json()['data']['outputs']
    assert len(outputs) == 1
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert compiled['text'] == '空屋里有张三'
    doc['cards'][0].update(object_id='room', name='空屋')
    doc['edges'][0]['source_port'] = 'object'
    rejected = await client.put(url, json={'request_id': 'wrong-purpose', 'expected_revision': 1, 'document': doc})
    assert rejected.status_code == 422
    assert rejected.json()['detail']['code'] == 'INCOMPATIBLE_PORT'


@pytest.mark.asyncio
@pytest.mark.parametrize('category', ['prop', 'costume'])
async def test_structural_categories_and_description_binding_protection(canvas_client, category):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '物件'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'id': 'item', 'type': 'content.object', 'object_id': 'item-one', 'name': '青色长袍', 'category': category, 'text': '正文可以提到任何类别。'}
    doc['cards'] = [source, {'id': 'model', 'type': 'model.text', 'prompt': {'segments': [{'id': 'r', 'kind': 'reference', 'source': {'canvas_id': canvas['id'], 'card_id': 'item', 'port_id': 'text', 'position': 0}}]}}]
    doc['edges'] = [{'id': 'edge', 'source_card': 'item', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}]
    doc['input_order'] = {'model': {'text': ['edge']}}
    assert (await client.put(url, json={'request_id': 'item', 'expected_revision': 0, 'document': doc})).status_code == 200
    source['name'] = '改名物件'
    assert (await client.put(url, json={'request_id': 'rename', 'expected_revision': 1, 'document': doc})).status_code == 200
    outputs = (await client.get(url + '/cards/item/outputs')).json()['data']['outputs']
    assert outputs[1]['payload'] == {'kind': 'object_reference', 'object_id': 'item-one', 'name': '改名物件', 'category': category}
    removed = {**doc, 'cards': doc['cards'][1:], 'edges': [], 'input_order': {}}
    rejection = await client.put(url, json={'request_id': 'remove', 'expected_revision': 2, 'document': removed})
    assert rejection.status_code == 422
    assert rejection.json()['detail']['code'] == 'REFERENCE_IN_USE'


@pytest.mark.asyncio
async def test_split_description_type_cannot_change_and_keeps_identity(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '类别修正'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    item = {'id': 'item', 'type': 'content.object', 'object_id': 'item-one', 'name': '长袍', 'category': 'prop', 'text': '丝绸'}
    doc['cards'] = [item]
    assert (await client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})).status_code == 200
    item['category'] = 'costume'
    corrected = await client.put(url, json={'request_id': 'correct', 'expected_revision': 1, 'document': doc})
    assert corrected.status_code == 422 and corrected.json()['detail']['code'] == 'INVALID_CARD_IDENTITY'
    outputs = (await client.get(url + '/cards/item/outputs')).json()['data']['outputs']
    assert outputs[1]['payload']['category'] == 'prop'
    assert outputs[1]['payload']['object_id'] == 'item-one'


@pytest.mark.asyncio
async def test_adopted_description_executes_with_its_own_identity_without_private_locator(runtime, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from app.task_worker import TaskWorker
    from tests.test_generation_canvas_runs import accept
    source = {'id': 'person', 'type': 'content.object', 'object_id': 'person-one', 'name': '张三',
              'category': 'character', 'text': '红衣，沉默。', 'source_locator': '私有手稿第2页'}
    runtime.document['cards'].append(source)
    runtime.document['cards'][0]['prompt'] = {'segments': [{'id': 'description', 'kind': 'reference', 'source': {
        'canvas_id': runtime.canvas_id, 'card_id': 'person', 'port_id': 'text', 'position': 0}}]}
    runtime.document['edges'] = [{'id': 'edge', 'source_card': 'person', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'}]
    runtime.document['input_order'] = {'m': {'text': ['edge']}}
    saved = await runtime.client.put(runtime.url, json={'request_id': 'description', 'expected_revision': 1, 'document': runtime.document})
    assert saved.status_code == 200, saved.text
    accepted, _ = await accept(runtime)
    received = []
    class Provider:
        def __init__(self, **_kwargs):
            pass
        async def astream(self, messages):
            received.append(messages[0].content)
            yield SimpleNamespace(content='已完成描述创作')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', Provider)
    worker = TaskWorker(runtime.sessions)
    try:
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
    finally:
        worker.text_pool.shutdown(wait=False)
    assert received == ['对象：张三（person-one，character）\n红衣，沉默。']
    snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(run for run in snapshot['runs'] if run['id'] == accepted['run_id'])['nodes'][0]
    assert node['status'] == 'succeeded'
    assert node['text'] == '已完成描述创作'


@pytest.mark.asyncio
@pytest.mark.parametrize('reverse, expected_descriptions', [
    (False, '对象：小雪（alice，character）\n红衣，沉默。\n对象：小李（bob，character）\n蓝衣，微笑。'),
    (True, '对象：小李（bob，character）\n蓝衣，微笑。\n对象：小雪（alice，character）\n红衣，沉默。'),
])
async def test_named_descriptions_keep_identity_in_actual_image_request(runtime, image_storage, reverse, expected_descriptions):
    import asyncio
    import json
    import httpx
    from tests.test_generation_canvas_images import image_card, accept
    from app.models.studio_prompts_files_timeline import FileItem
    from app.services.studio.file_usages import upsert_file_usage
    from app.task_worker import TaskWorker
    await image_card(runtime, 1)
    for oid in ('alice', 'bob'):
        key = 'references/' + oid
        image_storage[key] = (oid.encode(), 'image/png', {})
        async with runtime.sessions.begin() as db:
            db.add(FileItem(id=oid, name=oid, type='image', storage_key=key, content_type='image/png'))
            await db.flush()
            await upsert_file_usage(db, file_id=oid, project_id=runtime.project_id, chapter_id=None, usage_kind='upload')
    doc = runtime.document
    model = doc['cards'][0]
    model['prompt'] = {'segments': [{'id': 'body', 'kind': 'text', 'text': '画两人'}]}
    model['input_bindings'] = []
    doc['edges'] = []
    doc['input_order'] = {'image': {'text': [], 'image': []}}
    for oid, name, body in [('alice', '小雪', '红衣，沉默。'), ('bob', '小李', '蓝衣，微笑。')]:
        doc['cards'].append({'id': oid + '-text', 'type': 'content.object', 'object_id': oid, 'name': name, 'text': body})
        doc['cards'].append({'id': oid + '-ref', 'type': 'reference.character', 'input_bindings': [{'id': oid + '-name', 'input_port': 'name', 'source': {'canvas_id': runtime.canvas_id, 'card_id': oid + '-text', 'port_id': 'object', 'position': 0, 'object_id': oid}}], 'image_binding': {'file_id': oid}})
        edge = oid + '-name'
        doc['edges'].append({'id': edge, 'source_card': oid + '-text', 'source_port': 'object', 'target_card': oid + '-ref', 'target_port': 'name'})
        doc['input_order'][oid + '-ref'] = {'name': [edge]}
        for source, port in [(oid + '-text', 'text'), (oid + '-ref', 'image')]:
            edge = source + '-model'
            doc['edges'].append({'id': edge, 'source_card': source, 'source_port': port, 'target_card': 'image', 'target_port': port})
            doc['input_order']['image'][port].append(edge)
            model['input_bindings'].append({'id': edge, 'input_port': port, 'source': {'canvas_id': runtime.canvas_id, 'card_id': source, 'port_id': port, 'position': 0}})
    text_bindings = [binding for binding in model['input_bindings'] if binding['input_port'] == 'text']
    image_bindings = [binding for binding in model['input_bindings'] if binding['input_port'] == 'image']
    model['input_bindings'] = (text_bindings[::-1] if reverse else text_bindings) + image_bindings
    saved = await runtime.client.put(runtime.url, json={'request_id': 'descriptions', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    _, preview = await accept(runtime)
    received = []
    def provider(request):
        received.append(request.content.decode(errors='replace'))
        return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(received) == 1
    assert json.loads(received[0])['prompt'] == ('画两人\n' + expected_descriptions
        + '\n人物·小雪 = image 1（正面）\n人物·小李 = image 2（正面）')
    assert len(preview['input']['media']) == 2
