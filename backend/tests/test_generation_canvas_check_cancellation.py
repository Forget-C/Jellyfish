"""Cancellation and original report ownership through canvas HTTP and the real Worker."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.task_worker import TaskWorker
from tests.test_generation_canvas_checks import connect_check, duration_canvas, save_canvas
from tests.test_generation_canvas_runs import runtime  # noqa: F401


async def setup_check(runtime):
    document = duration_canvas(runtime.document)
    connect_check(document)
    document['cards'][3]['check_model_id'] = runtime.model_id
    await save_canvas(runtime.client, runtime.url, document, 1)
    return f'{runtime.url}/checks/check', document


async def start_check(client, checks):
    response = await client.get(checks)
    assert response.status_code == 200, response.text
    preview = response.json()['data']
    item = next(item for item in preview['items'] if item['category'] == 'P01')
    response = await client.post(f'{checks}/runs', json={
        'expected_revision': preview['basis']['revision'], 'basis_hash': preview['basis']['basis_hash'],
        'item_id': item['id'],
    })
    assert response.status_code == 200, response.text
    return response.json()['data']


async def reports(client, checks):
    response = await client.get(f'{checks}/reports')
    assert response.status_code == 200, response.text
    return response.json()['data']


@pytest.mark.asyncio
async def test_cancel_check_distinguishes_running_provider_from_queued_work(runtime, monkeypatch):
    client = runtime.client
    checks, _ = await setup_check(runtime)
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    class HeldModel:
        def __init__(self, **_params):
            pass

        async def ainvoke(self, _messages):
            calls.append('called')
            entered.set()
            await release.wait()
            return SimpleNamespace(content=json.dumps({'outcome': 'conforming', 'message': '迟到的供应商结果'}))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', HeldModel)
    worker = TaskWorker(runtime.sessions)
    try:
        running = await start_check(client, checks)
        await worker.tick()
        await asyncio.wait_for(entered.wait(), 3)
        queued = await start_check(client, checks)

        for report, expected in ((queued, 'cancelled'), (running, 'running')):
            response = await client.post(f"{checks}/reports/{report['id']}/cancel")
            assert response.status_code == 200, response.text
            data = response.json()['data']
            assert data['basis'] == report['basis'] and data['results'] == []
            assert data['executions'][0]['status'] == expected
            assert data['executions'][0]['cancel_requested']

        assert (await reports(client, checks))[1]['executions'][0]['status'] == 'running'
        release.set()
        await asyncio.gather(*worker.jobs.values())
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        history = await reports(client, checks)
        assert [report['executions'][0]['status'] for report in history] == ['cancelled', 'cancelled']
        assert all(not report['results'] for report in history)
        assert calls == ['called']
    finally:
        release.set()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)


@pytest.mark.parametrize('change', ['unlink', 'retarget', 'delete'])
@pytest.mark.asyncio
async def test_save_stops_only_checks_whose_original_target_was_removed(runtime, change):
    from tests.test_generation_canvas_runs import accept

    client, url = runtime.client, runtime.url
    checks, document = await setup_check(runtime)
    document['cards'] += [
        {'id': 'other-check', 'type': 'review.check', 'check_model_id': runtime.model_id},
        {'id': 'other-model', 'type': 'model.video', 'config': {'seconds': 5}},
        {'id': 'm', 'type': 'model.text', 'model_id': runtime.model_id,
         'prompt': {'segments': [{'id': 'body', 'kind': 'text', 'text': '独立生成'}]}},
    ]
    document['edges'].append({**document['edges'][1], 'id': 'other-observe', 'target_card': 'other-check'})
    document['input_order']['other-check'] = {'check_basis': ['other-observe']}
    await save_canvas(client, url, document, 2)

    preview = (await client.get(checks)).json()['data']
    item = next(item for item in preview['items'] if item['category'] == 'P06')
    response = await client.post(f'{checks}/runs', json={
        'expected_revision': preview['basis']['revision'], 'basis_hash': preview['basis']['basis_hash'],
        'item_id': item['id'],
    })
    assert response.status_code == 200, response.text
    complete = response.json()['data']
    original = await start_check(client, checks)
    other_url = f'{url}/checks/other-check'
    other = await start_check(client, other_url)
    generation, _ = await accept(runtime)

    wrong_card = await client.post(f"{other_url}/reports/{original['id']}/cancel")
    assert wrong_card.status_code == 404
    other_canvas = (await client.post(url.rsplit('/', 1)[0], json={'name': '其他画布'})).json()['data']
    wrong_canvas = await client.post(f"{url.rsplit('/', 1)[0]}/{other_canvas['id']}/checks/check/reports/{original['id']}/cancel")
    assert wrong_canvas.status_code == 404
    document['cards'][3]['enabled_categories'] = []
    document['cards'][3]['disabled_items'] = [original['items'][0]['id']]
    await save_canvas(client, url, document, 3)
    unchanged = (await reports(client, checks))[0]
    assert unchanged['id'] == original['id']
    assert unchanged['executions'][0]['status'] == 'queued'
    assert not unchanged['executions'][0].get('cancel_requested')

    if change == 'retarget':
        document['edges'][1]['source_card'] = 'other-model'
    else:
        document['edges'].pop(1)
        del document['input_order']['check']
        if change == 'delete':
            document['cards'].pop(3)
    await save_canvas(client, url, document, 4)

    cancelled, retained = await reports(client, checks)
    assert cancelled['id'] == original['id']
    assert cancelled['basis'] == original['basis'] and cancelled['basis']['target_card_id'] == 'model'
    assert cancelled['executions'][0]['status'] == 'cancelled'
    assert cancelled['results'] == []
    assert retained == complete
    assert (await reports(client, other_url))[0] == other
    active = (await client.get(f'{url}/runtime')).json()['data']
    node = next(node for run in active['runs'] if run['id'] == generation['run_id'] for node in run['nodes'])
    assert node['status'] == 'queued'
    if change == 'delete':
        assert (await client.get(checks)).status_code == 404
        archive = await client.get(f'{url}/check-reports/archived')
        assert archive.status_code == 200, archive.text
        assert archive.json()['data'] == [cancelled, retained]
