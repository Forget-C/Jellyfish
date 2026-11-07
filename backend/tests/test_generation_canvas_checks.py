"""检查卡通过公开保存、读取、执行和报告边界验收。"""
from copy import deepcopy

import pytest

from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


def duration_canvas(document):
    """本次生成明确采用的镜头时长，另有一张未采用设计作对照。"""
    document.update(cards=[
        {'id': 'shot', 'type': 'direction.shot', 'estimated_duration': {'text': '12 秒', 'state': 'proposal'}},
        {'id': 'unused', 'type': 'direction.shot', 'estimated_duration': {'text': '30 秒', 'state': 'fact'}},
        {'id': 'model', 'type': 'model.video', 'config': {'seconds': 5}},
        {'id': 'check', 'type': 'review.check'},
    ], edges=[
        {'id': 'adopt', 'source_card': 'shot', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'},
    ], input_order={'model': {'text': ['adopt']}})
    return document


def connect_check(document, source='model', port='check_basis', edge_id='observe'):
    document['edges'].append({
        'id': edge_id, 'source_card': source, 'source_port': port,
        'target_card': 'check', 'target_port': 'check_basis',
    })
    document['input_order'].setdefault('check', {}).setdefault('check_basis', []).append(edge_id)


async def save_canvas(client, url, document, revision, *, expected_status=200):
    response = await client.put(url, json={
        'request_id': f'save-{revision}', 'expected_revision': revision, 'document': document,
    })
    assert response.status_code == expected_status, response.text
    return response.json()


@pytest.mark.asyncio
async def test_check_reuses_actual_input_and_preserves_independent_reports(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '生成前检查'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    checks = f'{url}/checks/check'
    document = duration_canvas(canvas['document'])
    await save_canvas(client, url, document, 0)
    compiled = (await client.get(f'{url}/cards/model/compile')).json()['data']

    connect_check(document)
    await save_canvas(client, url, document, 1)
    basis = (await client.get(checks)).json()['data']
    assert basis['basis']['target_card_id'] == 'model'
    assert basis['basis']['input']['text'] == compiled['text']
    assert basis['basis']['parameters']['seconds'] == 5
    assert [source['source']['card_id'] for source in basis['basis']['input']['used']] == ['shot']
    assert any(issue['code'] == 'MODEL_REQUIRED' for issue in basis['basis']['input']['diagnostics'])
    assert (await client.get(f'{checks}/reports')).json()['data'] == []

    item, = (item for item in basis['items'] if item['category'] == 'P06')
    request = {'expected_revision': basis['basis']['revision'], 'basis_hash': basis['basis']['basis_hash']}
    response = await client.post(f'{checks}/runs', json=request)
    assert response.status_code == 200, response.text
    first = response.json()['data']
    assert first['scope'] == 'all'
    result, = first['results']
    assert result['outcome'] == 'risk'
    assert result['item_id'] == item['id']
    assert '12' in result['message'] and '5' in result['message']

    document = (await client.get(url)).json()['data']['document']
    document['cards'][0]['estimated_duration'] = {'text': '至少 12 秒', 'state': 'fact', 'purpose': 'constraint'}
    await save_canvas(client, url, document, 2)
    assert (await client.post(f'{checks}/runs', json=request)).status_code == 409
    updated = (await client.get(checks)).json()['data']
    response = await client.post(f'{checks}/runs', json={
        'expected_revision': updated['basis']['revision'], 'basis_hash': updated['basis']['basis_hash'], 'item_id': item['id'],
    })
    assert response.status_code == 200, response.text
    second = response.json()['data']
    assert second['id'] != first['id'] and second['scope'] == 'item'
    assert second['results'][0]['outcome'] == 'nonconforming'
    assert (await client.get(f'{checks}/reports')).json()['data'] == [second, first]
    assert (await client.get(f"/canvases/other/{canvas['id']}/checks/check/reports")).status_code == 404
    assert (await client.get(f'{url}/runtime')).json()['data']['runs'] == []


@pytest.mark.asyncio
async def test_check_rejects_invalid_and_second_observation_connection(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '检查连接限制'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = duration_canvas(canvas['document'])
    wrong = deepcopy(document)
    connect_check(wrong, port='video')
    await save_canvas(client, url, wrong, 0, expected_status=422)
    wrong = deepcopy(document)
    connect_check(wrong, source='other-canvas-model')
    await save_canvas(client, url, wrong, 0, expected_status=422)
    connect_check(document)
    await save_canvas(client, url, document, 0)
    document['cards'].append({'id': 'second', 'type': 'model.video'})
    connect_check(document, source='second', edge_id='second-observation')
    await save_canvas(client, url, document, 1, expected_status=422)
    assert (await client.get(url)).json()['data']['revision'] == 1


@pytest.mark.asyncio
async def test_disabling_business_check_does_not_bypass_invalid_generation_parameters(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '独立技术预检'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = duration_canvas(canvas['document'])
    document['cards'][2].update(model_id='canvas-video', config={'seconds': 5, 'ratio': '9:9'})
    document['cards'][3]['disabled_items'] = ['P06:shot:estimated_duration']
    connect_check(document)
    await save_canvas(client, url, document, 0)
    preview = (await client.get(f'{url}/checks/check')).json()['data']
    assert not preview['items'][0]['enabled']
    basis = preview['basis']
    assert (await client.post(f'{url}/checks/check/runs', json={
        'expected_revision': basis['revision'], 'basis_hash': basis['basis_hash'],
    })).status_code == 422
    generation = (await client.get(f'{url}/cards/model/compile')).json()['data']
    assert not generation['can_run']
    assert any(issue['code'] == 'INVALID_PARAMETER' for issue in generation['diagnostics'])
