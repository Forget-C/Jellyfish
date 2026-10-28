"""人物、物件和场所经画布 HTTP 保存并发布明确出口。"""
import pytest
from tests.test_generation_canvas_api import canvas_client  # noqa: F401
from tests.test_generation_canvas_runs import runtime  # noqa: F401


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
async def test_object_category_can_be_corrected_without_changing_identity(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '类别修正'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    item = {'id': 'item', 'type': 'content.object', 'object_id': 'item-one', 'name': '长袍', 'category': 'prop', 'text': '丝绸'}
    doc['cards'] = [item]
    assert (await client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})).status_code == 200
    item['category'] = 'costume'
    corrected = await client.put(url, json={'request_id': 'correct', 'expected_revision': 1, 'document': doc})
    assert corrected.status_code == 200, corrected.text
    outputs = (await client.get(url + '/cards/item/outputs')).json()['data']['outputs']
    assert outputs[1]['payload']['category'] == 'costume'
    assert outputs[1]['payload']['object_id'] == 'item-one'


@pytest.mark.asyncio
async def test_adopted_description_executes_through_worker_without_object_metadata(runtime, monkeypatch):
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
    assert received == ['红衣，沉默。']
    snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(run for run in snapshot['runs'] if run['id'] == accepted['run_id'])['nodes'][0]
    assert node['status'] == 'succeeded'
    assert node['text'] == '已完成描述创作'
