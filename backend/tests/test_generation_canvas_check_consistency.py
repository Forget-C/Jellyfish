"""P02 and P09 through the canvas API, task submitter and real Worker."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.task_worker import TaskWorker
from tests.test_generation_canvas_checks import save_canvas
from tests.test_generation_canvas_runs import runtime  # noqa: F401


async def save_requirements(runtime, cards, prompt=''):
    model = {'id': 'model', 'type': 'model.video', 'config': {'seconds': 5},
             'prompt': {'segments': [{'id': 'brief', 'kind': 'text', 'text': prompt}]}}
    edges = [{'id': f"use-{card['id']}", 'source_card': card['id'], 'source_port': 'text',
              'target_card': 'model', 'target_port': 'text'} for card in cards]
    document = {**runtime.document, 'cards': [*cards, model, {
        'id': 'check', 'type': 'review.check', 'check_model_id': runtime.model_id,
        'enabled_categories': ['P02', 'P09'],
    }], 'edges': [*edges, {
        'id': 'observe', 'source_card': 'model', 'source_port': 'check_basis',
        'target_card': 'check', 'target_port': 'check_basis',
    }], 'input_order': {'model': {'text': [edge['id'] for edge in edges]}, 'check': {'check_basis': ['observe']}}}
    await save_canvas(runtime.client, runtime.url, document, 1)
    return f'{runtime.url}/checks/check'


async def check_category(runtime, checks, category):
    client = runtime.client
    preview = (await client.get(checks)).json()['data']
    item, = (item for item in preview['items'] if item['category'] == category)
    response = await client.post(f'{checks}/runs', json={
        'expected_revision': preview['basis']['revision'], 'basis_hash': preview['basis']['basis_hash'],
        'item_id': item['id'],
    })
    assert response.status_code == 200, response.text
    assert response.json()['data']['executions'][0]['status'] == 'queued'
    worker = TaskWorker(runtime.sessions)
    try:
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        report = (await client.get(f'{checks}/reports')).json()['data'][0]
        assert report['executions'][0]['status'] == 'succeeded', report['executions']
        assert report['items'][0]['input_stamp'] == item['input_stamp']
        return report['results'][0]
    finally:
        worker.text_pool.shutdown(wait=False)


@pytest.mark.parametrize(('difference', 'outcome'), [
    (None, 'nonconforming'), ('phase', 'indeterminate'), ('condition', 'indeterminate'),
    ('proposal', 'risk'), ('undecided', 'risk'), ('invented', 'indeterminate'),
])
@pytest.mark.asyncio
async def test_consistency_requires_two_real_requirements_with_common_scope(runtime, monkeypatch, difference, outcome):
    scope = {'phase': '正式拍摄', 'description': '人物进入门口的前五秒', 'condition': '门保持打开'}
    camera = {'id': 'camera', 'type': 'direction.camera', 'scope': scope,
              'fields': {'position': {'text': '固定机位，不移动', 'state': 'fact'}}}
    movement = {'id': 'movement', 'type': 'direction.movement', 'scope': dict(scope),
                'fields': {'movement_path': {'text': '机位持续绕人物移动', 'state': 'fact'}}}
    if difference in ('proposal', 'undecided'):
        movement['fields']['movement_path']['state'] = difference
    if difference == 'phase':
        movement['scope']['phase'] = '试拍'
    if difference == 'condition':
        movement['scope']['condition'] = '门关闭后'

    class Model:
        def __init__(self, **_params):
            pass

        async def ainvoke(self, messages):
            body = json.loads(messages[1].content)
            assert body['requirements'][0]['text'] == '固定机位，不移动'
            assert body['requirements'][1]['scope']['description'] == scope['description']
            return SimpleNamespace(content=json.dumps({
                'outcome': 'nonconforming', 'message': '固定机位与持续绕行无法同时执行',
                'left': {'index': 0, 'excerpt': '固定机位，不移动'},
                'right': {'index': 1, 'excerpt': '虚构要求' if difference == 'invented' else '机位持续绕人物移动'},
            }))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', Model)
    checks = await save_requirements(runtime, [camera, movement])
    result = await check_category(runtime, checks, 'P02')
    assert result['outcome'] == outcome
    if difference is None:
        assert [(entry['source']['card_id'], entry['field_id'], entry['excerpt']) for entry in result['text_evidence']] == [
            ('camera', 'position', '固定机位，不移动'), ('movement', 'movement_path', '机位持续绕人物移动'),
        ]
        assert scope['description'] in result['message']


@pytest.mark.parametrize(('standard', 'reply', 'outcome'), [
    ('双手始终完整可见', {'outcome': 'conforming', 'submitted_excerpt': '门打开后双手始终完整可见'}, 'conforming'),
    ('画面要高级', {'outcome': 'risk', 'missing_basis': 'observable_result'}, 'risk'),
    ('画面要高级', {'outcome': 'risk', 'missing_basis': 'observable_result', 'requirement_excerpt': '机位卡缺失'}, 'indeterminate'),
])
@pytest.mark.asyncio
async def test_reviewability_is_anchored_to_adopted_criterion_and_actual_prompt(runtime, monkeypatch, standard, reply, outcome):
    criterion = {'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'result',
                 'name': '已采用验收要求', 'standard': {'state': 'fact', 'text': standard}}
    prompt = '门打开后双手始终完整可见，固定机位正对人物。'

    class Model:
        def __init__(self, **_params):
            pass

        async def ainvoke(self, messages):
            body = json.loads(messages[1].content)
            assert body['requirement']['source']['card_id'] == 'criterion'
            assert prompt in body['submitted_text']
            return SimpleNamespace(content=json.dumps({
                'message': '核对当前实际依据', 'requirement_excerpt': standard, **reply,
            }))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', Model)
    checks = await save_requirements(runtime, [criterion], prompt=prompt)
    result = await check_category(runtime, checks, 'P09')
    assert result['outcome'] == outcome
    assert '机位卡' not in result['message']
    if outcome in ('conforming', 'risk'):
        evidence, = result['text_evidence']
        assert evidence['source']['card_id'] == 'criterion' and evidence['excerpt'] == standard
    if outcome == 'risk':
        assert '可观察结果' in result['message']


@pytest.mark.asyncio
async def test_reviewability_has_no_item_for_missing_card_types(runtime):
    checks = await save_requirements(runtime, [], prompt='双手始终完整可见，固定机位正对人物。')
    preview = (await runtime.client.get(checks)).json()['data']
    assert preview['items'] == []
    assert next(category for category in preview['categories'] if category['id'] == 'P09')['availability'] == 'not_applicable'
