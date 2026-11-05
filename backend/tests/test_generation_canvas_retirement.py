"""旧摄影存量通过公开读写被有限清理，不迁移内容。"""
import pytest
from app.models.generation_canvas import GenerationCanvas
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_legacy_document_is_readable_and_requires_explicit_missing_design_handling(canvas_client, canvas_file_store):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '存量'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
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
    read = (await client.get(url)).json()['data']
    assert [card['id'] for card in read['document']['cards']] == ['keep', 'consumer']
    consumer = read['document']['cards'][1]
    assert consumer['missing_designs'] == ['old']
    assert consumer['prompt']['segments'] == [{'id': 'p', 'kind': 'text', 'text': '保留正文'}]
    assert read['document']['cards'][0]['text'] == '原样保留 @旧设计'
    compiled = (await client.get(url + '/cards/consumer/compile')).json()['data']
    assert any(issue['code'] == 'DESIGN_BASIS_MISSING' for issue in compiled['diagnostics'])
    command = {'request_id': 'save-cleaned', 'expected_revision': 0, 'document': read['document']}
    saved = await client.put(url, json=command)
    assert saved.status_code == 200, saved.text
    assert (await client.get(url)).json()['data']['document'] == read['document']
    assert (await client.put(url, json=command)).json() == saved.json()
    repaired = read['document'];repaired['cards'][1]['missing_designs'] = []
    assert (await client.put(url, json={'request_id':'handled','expected_revision':1,'document':repaired})).status_code == 200
    compiled = (await client.get(url + '/cards/consumer/compile')).json()['data']
    assert not any(issue['code'] == 'DESIGN_BASIS_MISSING' for issue in compiled['diagnostics'])


@pytest.mark.asyncio
async def test_catalog_no_longer_exposes_legacy_photography(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '新目录'})).json()['data']
    catalog = (await canvas_client.get(f"/canvases/p/{canvas['id']}/catalog")).json()['data']['cards']
    types = {card['type'] for card in catalog}
    assert 'direction.photography' not in types
    assert {'direction.style','direction.composition','direction.camera','direction.movement','direction.lighting','direction.focus'} <= types


from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('legacy', [
    {'id': 'retired', 'type': 'direction.photography'},
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
