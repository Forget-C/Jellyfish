"""四类描述、名称关联与按角度唯一的参考通过真实保存边界验证。"""
from tests.canvas_urls import canvas_url, seed_scene_canvas
from copy import deepcopy
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401
from app.schemas.generation_canvas import CanvasDocument


@pytest.mark.parametrize('category', ['character', 'prop', 'costume'])
def test_legacy_description_is_rejected_without_mutation(category):
    raw = {'id': 'c', 'project_id': 'p', 'name': '迁移', 'cards': [
        {'id': 'description', 'type': 'content.object', 'category': category, 'object_id': 'stable', 'name': '旧名称', 'text': '正文'},
        {'id': 'model', 'type': 'model.text'}],
        'edges': [{'id': 'e', 'source_card': 'description', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        'input_order': {'model': {'text': ['e']}}}
    original = deepcopy(raw)
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        CanvasDocument.model_validate(raw)
    assert raw == original


@pytest.mark.asyncio
@pytest.mark.parametrize('category', ['character', 'place', 'prop', 'costume'])
async def test_reference_names_follow_only_selected_same_type_description(canvas_client, category):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': category})).json()['data']
    url, doc = canvas_url(f"/canvases/p/{canvas['id']}"), canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'description', 'port_id': 'object', 'position': 0, 'object_id': 'entity'}
    doc.update(cards=[{'id': 'description', 'type': 'content.' + category, 'object_id': 'entity', 'name': '林夏', 'text': '不能传入参考的正文'},
        {'id': 'reference', 'type': 'reference.' + category, 'name': '独立名称'}],
        edges=[{'id': 'e', 'source_card': 'description', 'source_port': 'object', 'target_card': 'reference', 'target_port': 'name'}], input_order={'reference': {'name': ['e']}})
    async def save(revision):
        response = await client.put(url, json={'request_id': str(revision), 'expected_revision': revision, 'document': doc})
        assert response.status_code == 200, response.text
    async def outputs():
        return (await client.get(url + '/cards/reference/outputs')).json()['data']
    await save(0)
    assert (await outputs())['candidates'][0]['payload']['name'] == '林夏'
    assert (await outputs())['outputs'][0]['payload']['name'] == '独立名称', 'connection is not adoption'
    doc['cards'][1]['name_binding'] = source
    await save(1)
    result = await outputs()
    assert result['outputs'][0]['payload'] == {'kind': 'object_reference', 'object_id': 'entity', 'name': '林夏', 'category': category}
    assert '不能传入参考的正文' not in str(result)
    doc['cards'][0]['name'] = '改名'
    await save(2)
    reopened = (await client.get(url)).json()['data']['document']
    assert reopened['cards'][1]['name'] == '改名'
    doc.update(edges=[], input_order={})
    rejected = await client.put(url, json={'request_id': 'disconnect', 'expected_revision': 3, 'document': doc})
    assert rejected.status_code == 422 and rejected.json()['detail']['code'] == 'REFERENCE_IN_USE'
    doc['cards'][1]['name_binding'] = None
    doc['cards'][1]['name'] = '独立名称'
    await save(3)
    assert (await outputs())['outputs'][0]['payload']['object_id'] == 'reference'


@pytest.mark.asyncio
async def test_description_names_are_unique_only_in_same_type_and_basis_is_retained(canvas_client):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '命名范围'})).json()['data']
    url, doc = canvas_url(f"/canvases/p/{canvas['id']}"), canvas['document']
    doc['cards'] = [{'id': kind, 'type': 'content.' + kind, 'object_id': kind, 'name': '雨燕', 'text': ''} for kind in ['character', 'place', 'prop', 'costume']]
    doc['cards'].append({'id': 'basis', 'type': 'content.basis', 'text': '原文', 'source_locator': '第3章', 'selection_start': 1, 'selection_end': 3})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    reopened = (await client.get(url)).json()['data']['document']
    assert reopened['cards'][-1]['source_locator'] == '第3章'
    doc['cards'].append({'id': 'duplicate', 'type': 'content.character', 'object_id': 'second', 'name': ' 雨燕 '})
    response = await client.put(url, json={'request_id': 'duplicate', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'DUPLICATE_OBJECT_NAME'


@pytest.mark.asyncio
async def test_angles_share_bound_identity_and_protect_downstream_adoption(canvas_client):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '多角度'})).json()['data']
    url, doc = canvas_url(f"/canvases/p/{canvas['id']}"), canvas['document']
    binding = {'canvas_id': canvas['id'], 'card_id': 'person', 'port_id': 'object', 'position': 0, 'object_id': 'person'}
    doc.update(cards=[{'id': 'person', 'type': 'content.character', 'object_id': 'person', 'name': '林夏'},
        *[{'id': angle, 'type': 'reference.character', 'name_binding': binding, 'angle': angle} for angle in ['front', 'side']],
        {'id': 'act', 'type': 'direction.performance', 'input_bindings': [{'id': angle, 'input_port': 'participant', 'source': {**binding, 'card_id': angle}} for angle in ['front', 'side']]}],
        edges=[{'id': angle + '-name', 'source_card': 'person', 'source_port': 'object', 'target_card': angle, 'target_port': 'name'} for angle in ['front', 'side']] +
        [{'id': angle + '-act', 'source_card': angle, 'source_port': 'object', 'target_card': 'act', 'target_port': 'participant'} for angle in ['front', 'side']],
        input_order={angle: {'name': [angle + '-name']} for angle in ['front', 'side']} | {'act': {'participant': [angle + '-act' for angle in ['front', 'side']]}})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    doc['cards'][2]['angle'] = 'front'
    response = await client.put(url, json={'request_id': 'duplicate-draft', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 200, response.text
    assert (await client.get(url + '/cards/front/outputs')).json()['data']['outputs'] == []
    doc['cards'][0]['name'] = ''
    response = await client.put(url, json={'request_id': 'empty-draft', 'expected_revision': 2, 'document': doc})
    assert response.status_code == 200, response.text
    assert (await client.get(url + '/cards/front/outputs')).json()['data']['outputs'] == []
    doc['cards'][1]['name_binding'] = None
    response = await client.put(url, json={'request_id': 'detach', 'expected_revision': 3, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'REFERENCE_IN_USE'


@pytest.mark.asyncio
@pytest.mark.parametrize('category', ['place', 'prop', 'costume'])
async def test_name_candidate_edges_reject_other_description_types(canvas_client, category):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '类型匹配'})).json()['data']
    doc = canvas['document']
    doc.update(cards=[{'id': 'source', 'type': 'content.' + category, 'object_id': 'source', 'name': '名称'},
                      {'id': 'target', 'type': 'reference.character'}],
        edges=[{'id': 'e', 'source_card': 'source', 'source_port': 'object', 'target_card': 'target', 'target_port': 'name'}],
        input_order={'target': {'name': ['e']}})
    response = await client.put(canvas_url(f"/canvases/p/{canvas['id']}"), json={'request_id': 'mismatch', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'INVALID_REFERENCE_CATEGORY'


@pytest.mark.asyncio
async def test_store_reads_legacy_document_and_identity_registry_without_rewriting(canvas_client, canvas_file_store):
    from app.models.generation_canvas import GenerationCanvas
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '旧数据'})).json()['data']
    url, doc = canvas_url(f"/canvases/p/{canvas['id']}"), canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'description', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'description', 'type': 'content.object', 'category': 'costume', 'object_id': 'coat', 'name': '大衣', 'text': '旧描述'},
                      {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'adopted', 'input_port': 'text', 'source': source}]}],
        edges=[{'id': 'e', 'source_card': 'description', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['e']}})
    async with canvas_file_store['sessions'].begin() as db:
        stored = await db.get(GenerationCanvas, canvas['id'])
        stored.document = doc
        stored.card_types = {'description': 'content.object', 'model': 'model.text'}
    from copy import deepcopy
    from app.services.generation_canvas.store import CanvasStore
    async with canvas_file_store['sessions']() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        before = (deepcopy(row.document), deepcopy(row.card_types), row.revision)
        store = CanvasStore(db, 'p')
        await store.get(canvas['id'])
        await store.get(canvas['id'])
        await store.list()
        await db.refresh(row)
        assert (row.document, row.card_types, row.revision) == before
        assert not db.dirty
