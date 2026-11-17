"""通用对象退役通过公开读取、编译和真实任务执行验证。"""
from tests.canvas_urls import canvas_url, seed_scene_canvas
from copy import deepcopy
import asyncio
from types import SimpleNamespace
import pytest
from sqlalchemy import select
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401
from tests.test_generation_canvas_runs import runtime, accept  # noqa: F401

CASES = [('narrative', 'viewpoint'), ('event', 'action_change'), ('space_rule', 'spatial_basis'), ('anchor', 'position')]


def design_card(kind, field):
    card = {'id': 'design', 'type': 'direction.' + kind, field: {'text': '原有字段文字', 'authorship': 'user'}}
    if kind in ('narrative', 'event', 'anchor'):
        card['name'] = '设计名称'
    if kind in ('event', 'anchor'):
        card[kind + '_id'] = 'stable-design'
    return card


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,field', CASES)
async def test_reading_narrative_spatial_legacy_bindings_preserves_revision_and_connections(canvas_client, canvas_file_store, kind, field):
    from app.models.generation_canvas import GenerationCanvas
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '对象退役'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    source = lambda port: {'canvas_id': canvas['id'], 'card_id': 'place', 'port_id': port, 'position': 0, **({'object_id': 'hall'} if port == 'object' else {})}
    card = design_card(kind, field)
    card['input_bindings'] = [{'id': 'old', 'input_port': 'effect_object', 'source': source('object')}]
    edge = lambda ident, port, target: {'id': ident, 'source_card': 'place', 'source_port': port, 'target_card': 'design', 'target_port': target}
    doc = canvas['document']
    doc.update(cards=[{'id': 'place', 'type': 'content.place', 'name': '大厅', 'object_id': 'hall', 'text': '完整大厅说明'}, card,
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'design', 'input_port': 'text', 'source': {'canvas_id': canvas['id'], 'card_id': 'design', 'port_id': 'text', 'position': 0}}]}],
        edges=[edge('old', 'object', 'effect_object'), {'id': 'design-use', 'source_card': 'design', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'design': {'effect_object': ['old']}, 'model': {'text': ['design-use']}})
    if kind in ('anchor', 'space_rule'):
        card['input_bindings'].append({'id': 'space', 'input_port': 'space', 'source': source('object')})
        doc['edges'].append(edge('space', 'object', 'space'))
        doc['input_order']['design']['space'] = ['space']
    if kind == 'event':
        doc['cards'].append({'id': 'beat', 'type': 'direction.beat', 'beat_id': 'downstream', 'name': '后续节拍', 'input_bindings': [{'id': 'event', 'input_port': 'related_event', 'source': {'canvas_id': canvas['id'], 'card_id': 'design', 'port_id': 'event', 'position': 0, 'object_id': 'stable-design'}}]})
        doc['edges'].append({'id': 'event', 'source_card': 'design', 'source_port': 'event', 'target_card': 'beat', 'target_port': 'related_event'})
        doc['input_order']['beat'] = {'related_event': ['event']}
    async with canvas_file_store['sessions'].begin() as db:
        (await db.get(GenerationCanvas, canvas['id'])).document = doc
    first = (await canvas_client.get(url)).json()['data']
    assert first == (await canvas_client.get(url)).json()['data']
    assert first['revision'] == 0
    assert first['document']['edges'] == doc['edges']
    assert [(b['id'], b['input_port'], b['source']) for b in first['document']['cards'][1]['input_bindings']] == [(b['id'], b['input_port'], b['source']) for b in card['input_bindings']]


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,field', CASES)
async def test_narrative_spatial_retired_snapshot_is_rejected_before_provider(runtime, monkeypatch, kind, field):
    from app.models.generation_canvas import CanvasRunNode
    from app.task_worker import TaskWorker
    doc = runtime.document
    doc['cards'].insert(0, design_card(kind, field))
    saved = await runtime.client.put(runtime.url, json={'request_id': 'design', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    _, preview = await accept(runtime)
    async with runtime.sessions.begin() as db:
        node = await db.scalar(select(CanvasRunNode))
        snapshot = deepcopy(node.execution_snapshot)
        snapshot['document']['cards'][0]['input_bindings'] = [{'id': 'retired', 'input_port': 'effect_object', 'source': {'canvas_id': runtime.canvas_id, 'card_id': 'm', 'port_id': 'text', 'position': 0}}]
        node.execution_snapshot = snapshot
    received = []
    class Provider:
        def __init__(self, **kwargs):
            received.append(kwargs)
        async def astream(self, messages):
            yield SimpleNamespace(content='不应执行')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', Provider)
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    worker.text_pool.shutdown(wait=False)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['runs'][0]['nodes'][0]
    assert received == []
    assert state['status'] == 'failed' and state['error_code'] == 'LEGACY_ACCEPTANCE_SNAPSHOT'
    assert '重新提交' in state['error_message']
    assert state['basis']['input']['text'] == preview['input']['text']
