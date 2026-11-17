"""Semantic duration and rhythm checks through saved canvas HTTP and the actual Worker."""
from tests.canvas_urls import append_canvas_path
import pytest

from tests.test_generation_canvas_check_consistency import check_category, save_requirements
from tests.test_generation_canvas_check_sequence import stated, text_provider
from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.parametrize(('requirement', 'kind', 'scope', 'value', 'outcome'), [
    ('这条镜头预计会需要 12 秒。', 'estimated', 'request', '12', 'risk'),
    ('本镜头至少需要 8 秒。', 'minimum', 'request', '8', 'nonconforming'),
    ('本镜头固定为 5 秒。', 'fixed', 'request', '5', 'conforming'),
    ('前半段留 3 秒，之后接人物反应。', 'segment', 'part', '3', 'indeterminate'),
    ('整场必须保留 20 秒。', 'fixed', 'different', '20', 'indeterminate'),
    ('整场必须保留 20 秒。', 'fixed', 'request', '20', 'indeterminate'),
    ('本镜头预计 4 到 8 秒。', 'estimated', 'request', '8', 'indeterminate'),
    ('这条镜头预计会需要 12 秒。', 'estimated', 'request', '20', 'indeterminate'),
])
@pytest.mark.asyncio
async def test_free_text_duration_checks_its_type_scope_and_exact_value(runtime, monkeypatch, requirement, kind, scope, value, outcome):
    shot = {'id': 'shot', 'type': 'direction.shot',
            'estimated_duration': {**stated(requirement), 'purpose': 'constraint'}}

    def answer(body):
        assert body['seconds'] == 5 and body['requirement']['text'] == requirement
        return {'kind': kind, 'scope': scope, 'seconds': value, 'excerpt': requirement}

    text_provider(monkeypatch, answer)
    checks = await save_requirements(runtime, [shot])
    result = await check_category(runtime, checks, 'P06', recheck=kind == 'minimum')
    assert result['outcome'] == outcome
    evidence, = result['text_evidence']
    assert evidence['source']['card_id'] == 'shot' and evidence['excerpt'] == requirement


@pytest.mark.asyncio
async def test_text_scope_cannot_override_two_adopted_shots(runtime, monkeypatch):
    shots = [{'id': card, 'type': 'direction.shot',
              'estimated_duration': {**stated('本镜头至少需要 8 秒。'), 'purpose': 'constraint'}}
             for card in ('first', 'second')]
    text_provider(monkeypatch, lambda _: {
        'kind': 'minimum', 'scope': 'request', 'seconds': '8', 'excerpt': '本镜头至少需要 8 秒。',
    })
    checks = await save_requirements(runtime, shots)
    result = await check_category(runtime, checks, 'P06', source_card_id='first')
    assert result['outcome'] == 'indeterminate'
    assert '范围' in result['message']


@pytest.mark.parametrize(('risk_basis', 'outcome'), [
    ('duration_sum', 'indeterminate'), ('sequence_load', 'indeterminate'), ('dialogue_density', 'risk'),
])
@pytest.mark.asyncio
async def test_rhythm_checks_actual_parallel_actions_and_dialogue_without_hard_rates(runtime, monkeypatch, risk_basis, outcome):
    cards = [
        {'id': 'activity', 'type': 'direction.activity', 'task': stated('两人同时走向门口，各用 4 秒')},
        {'id': 'move', 'type': 'direction.movement', 'fields': {'movement_path': stated('与演员并行横移')}},
        {'id': 'dialogue', 'type': 'direction.dialogue', 'dialogue_id': 'line', 'content': stated('等等，别关门，我还有事没说完。')},
    ]

    def answer(body):
        assert body['seconds'] == 5
        rows = body['requirements']
        indexes = {row['source']['card_id']: index for index, row in enumerate(rows)}
        assert set(indexes) == {'activity', 'move', 'dialogue'}
        quotes = ('activity', 'move') if risk_basis != 'dialogue_density' else ('dialogue',)
        return {'outcome': 'risk', 'risk_basis': risk_basis, 'message': '节奏空间可能不足',
                'quotes': [{'index': indexes[key], 'excerpt': rows[indexes[key]]['text']} for key in quotes]}

    text_provider(monkeypatch, answer)
    checks = await save_requirements(runtime, cards)
    result = await check_category(runtime, checks, 'P07', recheck=risk_basis == 'dialogue_density')
    assert result['outcome'] == outcome
    assert '发音' in result['boundary'] and '口型' in result['boundary']
    assert {entry['source']['card_id'] for entry in result['text_evidence']} == (
        {'activity', 'move'} if risk_basis != 'dialogue_density' else {'dialogue'}
    )


@pytest.mark.asyncio
async def test_clear_duration_keeps_one_rule_result_when_check_model_is_configured(runtime):
    client = runtime.client
    shot = {'id': 'shot', 'type': 'direction.shot',
            'estimated_duration': {**stated('固定 8 秒'), 'purpose': 'constraint'}}
    checks = await save_requirements(runtime, [shot])
    preview = (await client.get(checks)).json()['data']
    item, = (item for item in preview['items'] if item['category'] == 'P06')
    response = await client.post(append_canvas_path(checks, f'/runs'), json={
        'expected_revision': preview['basis']['revision'], 'basis_hash': preview['basis']['basis_hash'],
        'item_id': item['id'],
    })
    assert response.status_code == 200, response.text
    report = response.json()['data']
    assert report['executions'] == []
    result, = report['results']
    assert result['item_id'] == item['id'] and result['outcome'] == 'nonconforming'
