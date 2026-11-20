"""Historical rule rechecks use public admission and the pinned report basis."""
from tests.canvas_urls import append_canvas_path, canvas_url, seed_scene_canvas
from copy import deepcopy

import pytest

from app.models.generation_canvas import CanvasCheckReport

from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401
from tests.test_generation_canvas_checks import connect_check, duration_canvas, save_canvas
from tests.test_generation_canvas_check_selection import run_request


@pytest.mark.asyncio
async def test_rule_recheck_uses_original_duration_after_edit_and_card_deletion(canvas_client, canvas_file_store):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '时长原报告复核'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    checks = (url + f'/checks/check')
    document = duration_canvas(canvas['document'])
    document['cards'][0]['estimated_duration'] = {'text': '至少 12 秒', 'state': 'fact', 'purpose': 'constraint'}
    connect_check(document)
    await save_canvas(client, url, document, 0)

    async def ordinary():
        basis = (await client.get(checks)).json()['data']
        return (await client.post(append_canvas_path(checks, f'/runs'), json=run_request(basis))).json()['data']

    original = await ordinary()
    finding, = original['results']
    assert finding['outcome'] == 'nonconforming'
    document = (await client.get(url)).json()['data']['document']
    document['cards'][2]['config']['seconds'] = 12
    await save_canvas(client, url, document, 1)
    path = append_canvas_path(checks, f"/reports/{original['id']}/recheck")
    payload = {'item_id': finding['item_id'], 'clarification': '  这次忽略最低时长，算符合。  '}
    response = await client.post(path, json=payload)
    assert response.status_code == 200, response.text
    rechecked = response.json()['data']
    assert rechecked['id'] != original['id'] and rechecked['scope'] == 'item'
    assert rechecked['basis'] == original['basis'] and rechecked['items'] == original['items']
    assert rechecked['results'] == original['results']
    assert rechecked['recheck'] == {
        'report_id': original['id'], 'clarification': '这次忽略最低时长，算符合。', 'original_result': finding,
    }

    invalid = await client.post(path, json={**payload, 'clarification': '  '})
    assert invalid.status_code == 422
    assert (await client.post(path.replace('project_id=p', 'project_id=other'), json=payload)).status_code == 404
    assert (await client.post(path.replace('/checks/check/', '/checks/other/'), json=payload)).status_code == 404
    assert (await client.get(append_canvas_path(checks, f'/reports'))).json()['data'] == [rechecked, original]
    current = await ordinary()
    assert current['results'][0]['outcome'] == 'conforming' and current['recheck'] is None

    document = (await client.get(url)).json()['data']['document']
    document['cards'] = [card for card in document['cards'] if card['id'] != 'check']
    document['edges'] = [edge for edge in document['edges'] if edge['target_card'] != 'check']
    del document['input_order']['check']
    await save_canvas(client, url, document, 2)
    response = await client.post(path, json=payload)
    assert response.status_code == 200, response.text
    archived = (await client.get((url + f'/check-reports/archived'))).json()['data']
    assert archived[0] == response.json()['data']
    assert archived[-1] == original

    async with canvas_file_store['sessions'].begin() as db:
        row = await db.get(CanvasCheckReport, original['id'])
        missing = deepcopy(row.report)
        missing['basis']['input']['used'] = []
        row.report = missing
    response = await client.post(path, json=payload)
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'CHECK_RECHECK_BASIS_UNAVAILABLE'
    assert len((await client.get((url + f'/check-reports/archived'))).json()['data']) == len(archived)
