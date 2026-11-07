"""Action and continuity observations through public HTTP and the real task worker."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.task_worker import TaskWorker
from tests.test_generation_canvas_checks import save_canvas
from tests.test_generation_canvas_runs import runtime  # noqa: F401


def stated(text):
    return {'state': 'fact', 'text': text}


def binding(canvas_id, card_id, source_port, object_id, target_port):
    return {'id': f'{card_id}-{target_port}', 'input_port': target_port, 'source': {
        'canvas_id': canvas_id, 'card_id': card_id, 'port_id': source_port, 'position': 0, 'object_id': object_id,
    }}


async def run_check(runtime, category, design, related):
    client, url = runtime.client, runtime.url
    checks = f'{url}/checks/check'
    edges = [{'id': item['id'], 'source_card': item['source']['card_id'], 'source_port': item['source']['port_id'],
              'target_card': design['id'], 'target_port': item['input_port']} for item in design.get('input_bindings', [])]
    document = {**runtime.document, 'cards': [*related, design,
        {'id': 'model', 'type': 'model.video', 'config': {'seconds': 5}},
        {'id': 'check', 'type': 'review.check', 'check_model_id': runtime.model_id, 'enabled_categories': [category]},
    ], 'edges': [*edges,
        {'id': 'adopt', 'source_card': design['id'], 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'},
        {'id': 'observe', 'source_card': 'model', 'source_port': 'check_basis', 'target_card': 'check', 'target_port': 'check_basis'},
    ], 'input_order': {
        design['id']: {edge['target_port']: [edge['id']] for edge in edges},
        'model': {'text': ['adopt']}, 'check': {'check_basis': ['observe']},
    }}
    await save_canvas(client, url, document, 1)
    preview = (await client.get(checks)).json()['data']
    item, = (item for item in preview['items'] if item['category'] == category and item['source']['card_id'] == design['id'])
    assert item['availability'] == 'ready' and item['input_stamp']
    response = await client.post(f'{checks}/runs', json={
        'expected_revision': preview['basis']['revision'], 'basis_hash': preview['basis']['basis_hash'], 'item_id': item['id'],
    })
    assert response.status_code == 200, response.text
    worker = TaskWorker(runtime.sessions)
    try:
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        report = (await client.get(f'{checks}/reports')).json()['data'][0]
        assert report['executions'][0]['status'] == 'succeeded'
        return report['results'][0]
    finally:
        worker.text_pool.shutdown(wait=False)


def text_provider(monkeypatch, answer):
    class Provider:
        def __init__(self, **_params):
            pass

        async def ainvoke(self, messages):
            return SimpleNamespace(content=json.dumps(answer(json.loads(messages[1].content))))
    monkeypatch.setattr('app.task_worker.ChatOpenAI', Provider)


@pytest.mark.asyncio
async def test_action_check_uses_actual_trigger_structured_delay_and_entry_exit(runtime, monkeypatch):
    scope = {'description': '门口一段', 'phase': '正式拍摄'}
    event = {'id': 'door', 'type': 'direction.event', 'event_id': 'opened', 'name': '门响',
             'scope': scope, 'action_change': stated('门响一次')}
    stray = {'id': 'unadopted', 'type': 'direction.event', 'event_id': 'other', 'name': '无关事件',
             'action_change': stated('远处无关事件')}
    design = {'id': 'activity', 'type': 'direction.activity', 'scope': scope,
              'input_bindings': [binding(runtime.canvas_id, 'door', 'event', 'opened', 'trigger_event')],
              'task': stated('门响后抬头'), 'delay_ms': 800, 'entry_exit': stated('抬头后向左出画')}

    def answer(body):
        rows = body['requirements']
        indexes = {row['field_id']: index for index, row in enumerate(rows)}
        assert rows[indexes['delay_ms']]['value_ms'] == 800
        assert rows[indexes['action_change']]['source']['card_id'] == 'door'
        assert body['relations'][0]['reference']['reference_id'] == 'opened'
        assert all(row['source']['card_id'] != 'unadopted' for row in rows)
        return {'outcome': 'nonconforming', 'message': '这一节拍可能过于仓促', 'quotes': [
            {'index': indexes['action_change'], 'excerpt': '门响一次'},
            {'index': indexes['entry_exit'], 'excerpt': '抬头后向左出画'},
        ]}

    text_provider(monkeypatch, answer)
    result = await run_check(runtime, 'P04', design, [event, stray])
    assert result['outcome'] == 'risk'
    assert {row['source']['card_id'] for row in result['text_evidence']} == {'activity', 'door'}


@pytest.mark.parametrize(('case', 'outcome'), [
    ('transition', 'conforming'), ('hold', 'nonconforming'), ('unexplained', 'indeterminate'),
    ('related_event', 'conforming'), ('other_object', 'risk'),
    ('different_stage', 'indeterminate'),
])
@pytest.mark.asyncio
async def test_continuity_checks_distinguish_change_hold_and_missing_change(runtime, monkeypatch, case, outcome):
    scope = {'description': '开门这一段', 'phase': '正式拍摄'}
    prop = {'id': 'prop', 'type': 'content.prop', 'name': '雨伞', 'object_id': 'umbrella', 'text': '雨伞'}
    event = {'id': 'event', 'type': 'direction.event', 'event_id': 'fold', 'name': '收伞',
             'scope': {**scope, 'phase': '试拍'}, 'action_change': stated('收起雨伞')}
    design = {'id': 'continuity', 'type': 'direction.continuity', 'scope': scope,
              'before': stated('雨伞撑开'), 'after': stated('雨伞收拢'),
              'input_bindings': [binding(runtime.canvas_id, 'prop', 'object', 'umbrella', 'participant')]}
    if case == 'transition':
        design['change'] = stated('演员收起雨伞')
    if case in ('hold', 'other_object'):
        design['following_constraints'] = stated('这一段雨伞必须一直撑开')
    if case == 'other_object':
        design['after'] = stated('雨衣收起来')
    if case == 'related_event':
        event['scope'] = scope
    if case in ('different_stage', 'related_event'):
        design['input_bindings'].append(binding(runtime.canvas_id, 'event', 'event', 'fold', 'related_event'))

    def answer(body):
        rows = body['requirements']
        indexes = {row['field_id']: index for index, row in enumerate(rows)}
        assert rows[0]['objects'] == {'umbrella': '雨伞'}
        assert any(row['source']['card_id'] == 'event' for row in rows) == (case == 'related_event')
        fields = {
            'transition': ('before', 'change', 'after'), 'hold': ('following_constraints', 'after'),
            'other_object': ('following_constraints', 'after'), 'related_event': ('before', 'action_change', 'after'),
        }.get(case, ('before', 'after'))
        return {'outcome': 'nonconforming' if case in ('hold', 'other_object') else 'conforming', 'message': '核对雨伞的状态',
                'quotes': [{'index': indexes[field], 'excerpt': rows[indexes[field]]['text']} for field in fields]}

    text_provider(monkeypatch, answer)
    result = await run_check(runtime, 'P05', design, [prop, event])
    assert result['outcome'] == outcome
    sources = {row['source']['card_id'] for row in result['text_evidence']}
    assert sources == ({'continuity', 'event'} if case == 'related_event' else {'continuity'})
