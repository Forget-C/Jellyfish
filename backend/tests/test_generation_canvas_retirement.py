"""严格拒绝旧格式保存与执行，Store 读取保留原始文档、身份及修订。"""
from tests.canvas_urls import canvas_url, seed_scene_canvas
import pytest
from app.models.generation_canvas import GenerationCanvas
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_store_reads_legacy_photography_without_rewriting(canvas_client, canvas_file_store):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '存量'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    source = {'canvas_id': canvas['id'], 'card_id': 'old', 'port_id': 'text', 'position': 0}
    raw = {**canvas['document'], 'cards': [
        {'id': 'old', 'type': 'direction.photography', 'fields': {'movement_path': {'state': 'fact', 'text': '旧运镜'}}},
        {'id': 'keep', 'type': 'content.text', 'text': '原样保留 @旧设计'},
        {'id': 'consumer', 'type': 'model.text', 'input_bindings': [{'id': 'use', 'input_port': 'text', 'source': source, 'photography_scope': ['region:movement']}], 'prompt': {'segments': [{'id': 'p', 'kind': 'text', 'text': '保留正文'}, {'id': 'r', 'kind': 'reference', 'binding_id': 'use'}]}}],
        'edges': [{'id': 'old-edge', 'source_card': 'old', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}],
        'input_order': {'consumer': {'text': ['old-edge']}}, 'groups': []}
    async with canvas_file_store['sessions'].begin() as db:
        stored = await db.get(GenerationCanvas, canvas['id'])
        stored.document = raw
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


@pytest.mark.asyncio
async def test_catalog_no_longer_exposes_legacy_photography(canvas_client):
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '新目录'})).json()['data']
    catalog = (await canvas_client.get(canvas_url(f"/canvases/p/{canvas['id']}/catalog"))).json()['data']['cards']
    types = {card['type'] for card in catalog}
    assert 'direction.photography' not in types
    assert {'direction.style','direction.composition','direction.camera','direction.movement','direction.lighting','direction.focus'} <= types


from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('legacy', [
    {'id': 'retired', 'type': 'direction.photography'},
    {'id': 'retired', 'type': 'reference.character', 'title': '旧参考'},
    {'id': 'retired', 'type': 'content.object', 'category': 'character'},
    {'id': 'retired', 'type': 'direction.criterion', 'examples': [{'id': 'old', 'file_id': 'old'}]},
])
async def test_legacy_fixed_design_is_not_cleaned_into_executable_history(runtime, legacy):
    from copy import deepcopy
    from sqlalchemy import select
    from app.models.generation_canvas import CanvasRunNode
    from tests.test_generation_canvas_execution_basis import historical_waiter, finish_source, history
    accepted, _ = await historical_waiter(runtime)
    async with runtime.sessions.begin() as db:
        node = await db.scalar(select(CanvasRunNode).where(CanvasRunNode.run_id == accepted['run_id'], CanvasRunNode.card_id == 'B'))
        snapshot = deepcopy(node.execution_snapshot)
        snapshot['document']['cards'].append(legacy)
        node.execution_snapshot = snapshot
    await finish_source(runtime, accepted, result={'text':'New source'})
    _, nodes = await history(runtime, accepted)
    assert nodes['B']['status'] == 'failed'
    assert nodes['B']['error_code'] == 'LEGACY_DESIGN_SNAPSHOT'
    assert nodes['B']['task_id'] is None
    assert nodes['m']['status'] == 'succeeded'


@pytest.mark.asyncio
@pytest.mark.parametrize('old_card', [
    {'id': 'old', 'type': 'content.object', 'category': 'character'},
    {'id': 'old', 'type': 'direction.photography'},
    {'id': 'old', 'type': 'reference.character', 'title': '旧参考'},
])
async def test_legacy_save_is_rejected_without_receipt_or_document_change(canvas_client, old_card):
    from copy import deepcopy
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '严格格式'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    document = deepcopy(canvas['document'])
    document['cards'] = [old_card]
    original = deepcopy(document)
    response = await canvas_client.put(url, json={'request_id': 'retry', 'expected_revision': 0, 'document': document})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'INVALID_DOCUMENT'
    assert document == original
    read = (await canvas_client.get(url)).json()['data']
    assert read['document'] == canvas['document'] and read['revision'] == 0
    assert (await canvas_client.put(url, json={'request_id': 'retry', 'expected_revision': 0, 'document': canvas['document']})).status_code == 200


@pytest.mark.asyncio
async def test_retired_identity_tombstone_survives_save_and_prevents_reuse(canvas_client, canvas_file_store):
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '墓碑'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    async with canvas_file_store['sessions'].begin() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        row.card_types = {'retired': 'content.object'}
    assert (await canvas_client.put(url, json={'request_id': 'empty', 'expected_revision': 0, 'document': canvas['document']})).status_code == 200
    document = {**canvas['document'], 'cards': [{'id': 'retired', 'type': 'content.character'}]}
    response = await canvas_client.put(url, json={'request_id': 'reuse', 'expected_revision': 1, 'document': document})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'INVALID_CARD_IDENTITY'
    async with canvas_file_store['sessions']() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        assert row.card_types == {'retired': 'content.object'}


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['style', 'composition', 'movement', 'camera', 'lighting', 'focus'])
async def test_visual_design_nonempty_retired_examples_are_rejected(canvas_client, kind):
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '严格设计'})).json()['data']
    document = {**canvas['document'], 'cards': [{'id': 'design', 'type': 'direction.' + kind,
        'examples': [{'id': 'example', 'file_id': 'missing', 'source': {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}}]}]}
    response = await canvas_client.put(canvas_url(f"/canvases/p/{canvas['id']}"), json={'request_id': 'old-example', 'expected_revision': 0, 'document': document})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'INVALID_DOCUMENT'


@pytest.mark.asyncio
async def test_worker_rejects_legacy_reference_without_modifying_snapshot_or_calling_provider(runtime, monkeypatch):
    import asyncio
    from copy import deepcopy
    from sqlalchemy import select
    from app.models.generation_canvas import CanvasRunNode
    from app.task_worker import TaskWorker
    from tests.test_generation_canvas_runs import accept
    accepted, _ = await accept(runtime)
    async with runtime.sessions.begin() as db:
        node = await db.scalar(select(CanvasRunNode).where(CanvasRunNode.task_id == accepted['task_ids'][0]))
        snapshot = deepcopy(node.execution_snapshot)
        snapshot['document']['cards'].append({'id': 'legacy', 'type': 'reference.character', 'title': '旧参考'})
        node.execution_snapshot = snapshot
    calls = []
    def provider(**kwargs):
        calls.append(kwargs)
        raise AssertionError('unsupported snapshot must not call provider')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', provider)
    worker = TaskWorker(runtime.sessions)
    try:
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
    finally:
        worker.text_pool.shutdown(wait=False)
    assert not calls
    async with runtime.sessions() as db:
        node = await db.scalar(select(CanvasRunNode).where(CanvasRunNode.task_id == accepted['task_ids'][0]))
        assert node.status == 'failed' and node.error_code == 'LEGACY_DESIGN_SNAPSHOT'
        assert node.execution_snapshot == snapshot
