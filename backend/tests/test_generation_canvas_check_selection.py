"""检查卡开关和范围按来源稳定保留，通过保存、预览和执行验证。"""
import pytest

from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401
from tests.test_generation_canvas_checks import connect_check, duration_canvas, save_canvas


def run_request(preview, **selection):
    basis = preview['basis']
    return {'expected_revision': basis['revision'], 'basis_hash': basis['basis_hash'], **selection}


@pytest.mark.asyncio
async def test_check_selection_survives_source_replacement_and_keeps_history(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '检查范围选择'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    checks = f'{url}/checks/check'
    document = duration_canvas(canvas['document'])
    connect_check(document)
    await save_canvas(client, url, document, 0)
    first = (await client.get(checks)).json()['data']
    item, = first['items']
    assert first['categories'][0]['id'] == 'P06' and first['categories'][0]['enabled']
    original = (await client.post(f'{checks}/runs', json=run_request(first))).json()['data']

    document = (await client.get(url)).json()['data']['document']
    check = next(card for card in document['cards'] if card['id'] == 'check')
    check.update(enabled_categories=[], disabled_items=[item['id']], scope_notes={item['id']: '核对本镜头'})
    edge = next(edge for edge in document['edges'] if edge['id'] == 'adopt')
    edge['source_card'] = 'unused'
    document['input_order']['model']['text'] = [edge['id']]
    await save_canvas(client, url, document, 1)
    replacement = (await client.get(checks)).json()['data']
    derived, = replacement['items']
    assert derived['source']['card_id'] == 'unused' and derived['id'] != item['id']
    assert not derived['enabled'] and not replacement['categories'][0]['enabled']
    assert (await client.post(f'{checks}/runs', json=run_request(replacement))).status_code == 422
    single = await client.post(f'{checks}/runs', json=run_request(replacement, item_id=derived['id']))
    assert single.status_code == 200, single.text
    assert single.json()['data']['scope'] == 'item'
    assert [result['item_id'] for result in single.json()['data']['results']] == [derived['id']]

    document = (await client.get(url)).json()['data']['document']
    check = next(card for card in document['cards'] if card['id'] == 'check')
    check['enabled_categories'] = ['P06']
    edge = next(edge for edge in document['edges'] if edge['id'] == 'adopt')
    edge['source_card'] = 'shot'
    await save_canvas(client, url, document, 2)
    restored = (await client.get(checks)).json()['data']
    derived, = restored['items']
    assert restored['categories'][0]['enabled'] and not derived['enabled']
    assert derived['id'] == item['id'] and derived['scope_note'] == '核对本镜头'
    assert (await client.get(f'{checks}/reports')).json()['data'][-1] == original


@pytest.mark.asyncio
async def test_missing_seconds_keeps_applicable_item_but_empty_duration_is_not_applicable(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '检查项适用性'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    checks = f'{url}/checks/check'
    document = duration_canvas(canvas['document'])
    document['cards'][2]['config'] = {}
    connect_check(document)
    await save_canvas(client, url, document, 0)

    preview = (await client.get(checks)).json()['data']
    assert preview['categories'][0]['availability'] == 'unavailable'
    item, = preview['items']
    assert item['availability'] == 'unavailable' and item['reason'] == '请先填写本次生成时长'
    assert (await client.post(f'{checks}/runs', json=run_request(preview, item_id=item['id']))).status_code == 422
    assert (await client.get(f'{checks}/reports')).json()['data'] == []

    document = (await client.get(url)).json()['data']['document']
    document['cards'][0]['estimated_duration'] = {'state': 'empty', 'text': ''}
    await save_canvas(client, url, document, 1)
    preview = (await client.get(checks)).json()['data']
    assert preview['categories'][0]['availability'] == 'not_applicable'
    assert preview['items'] == []


@pytest.mark.asyncio
async def test_unrelated_shots_remain_unavailable_instead_of_compared_to_whole_duration(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '不擅自汇总时长'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = duration_canvas(canvas['document'])
    document['edges'].append({
        'id': 'adopt-second', 'source_card': 'unused', 'source_port': 'text',
        'target_card': 'model', 'target_port': 'text',
    })
    document['input_order']['model']['text'].append('adopt-second')
    connect_check(document)
    await save_canvas(client, url, document, 0)
    preview = (await client.get(f'{url}/checks/check')).json()['data']
    assert {item['source']['card_id'] for item in preview['items']} == {'shot', 'unused'}
    assert {item['availability'] for item in preview['items']} == {'unavailable'}
    assert all('同一范围' in item['reason'] for item in preview['items'])
    assert (await client.post(f'{url}/checks/check/runs', json=run_request(preview))).status_code == 422
