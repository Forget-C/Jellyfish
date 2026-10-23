"""Target execution through HTTP, real submission and the actual Worker."""
from copy import deepcopy
from types import SimpleNamespace
import asyncio
import pytest
from tests.test_generation_canvas_runs import runtime  # noqa: F401
from app.task_worker import TaskWorker


async def save(state, document):
    current = (await state.client.get(state.url)).json()['data']
    response = await state.client.put(state.url, json={'request_id': str(current['revision']),
        'expected_revision': current['revision'], 'document': document})
    assert response.status_code == 200, response.text


async def run(state, card, kind='single'):
    response = await state.client.post(state.url + '/precheck', json={'card_id': card, 'kind': kind})
    assert response.status_code == 200, response.text
    preview = response.json()['data']
    assert preview['can_run'], preview
    response = await state.client.post(state.url + '/runs', json={'request_id': preview['preview_token'], 'preview_token': preview['preview_token']})
    assert response.status_code == 200, response.text
    return response.json()['data'], preview


async def drain(worker, rounds=6):
    for _ in range(rounds):
        await worker.tick()
        if worker.jobs:
            await asyncio.gather(*worker.jobs.values())


async def chain(state, monkeypatch):
    calls = []
    class Model:
        def __init__(self, **params):
            self.params = params
        async def astream(self, messages):
            calls.append((messages[0].content, self.params))
            yield SimpleNamespace(content='out(' + messages[0].content + ')')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', Model)
    worker = TaskWorker(state.sessions)
    doc = deepcopy(state.document)
    doc['cards'] = [{'id': name, 'type': 'model.text', 'model_id': state.model_id,
        'prompt': {'segments': [{'id': 'body' + name, 'kind': 'text', 'text': name}]}} for name in ['A', 'B', 'C', 'X', 'Y']]
    await save(state, doc)
    for name in ['A', 'B', 'C', 'X', 'Y']:
        await run(state, name)
        await drain(worker)
    for source, target in [('A', 'B'), ('B', 'C'), ('X', 'Y')]:
        doc.setdefault('edges', []).append({'id': source + target, 'source_card': source, 'source_port': 'text', 'target_card': target, 'target_port': 'text'})
        doc.setdefault('input_order', {})[target] = {'text': [source + target]}
        card = next(item for item in doc['cards'] if item['id'] == target)
        card['prompt']['segments'] = [{'kind': 'reference', 'id': 'ref' + target,
            'source': {'canvas_id': state.canvas_id, 'card_id': source, 'port_id': 'text', 'position': 0}}]
    await save(state, doc)
    calls.clear()
    return doc, calls, worker


@pytest.mark.asyncio
async def test_target_reuses_valid_upstream_and_freezes_waiting_actual_request(runtime, monkeypatch):
    from app.models.llm import Model, Provider
    doc, calls, worker = await chain(runtime, monkeypatch)
    accepted, preview = await run(runtime, 'C', 'target')
    assert preview['execution_nodes'] == ['B', 'C']
    assert len(preview['reused_results']) == 1
    assert len(accepted['task_ids']) == 1
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    nodes = next(item for item in state['runs'] if item['id'] == accepted['run_id'])['nodes']
    assert {item['card_id']: item['status'] for item in nodes} == {'B': 'queued', 'C': 'waiting'}
    doc['cards'][2]['prompt'] = {'segments': [{'kind': 'text', 'id': 'later', 'text': 'later edit'}]}
    await save(runtime, doc)
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.name, model.params = 'changed', {'temperature': .9}
        provider = await db.get(Provider, runtime.provider_id)
        provider.api_key, provider.base_url = 'changed', 'https://changed.test'
    await drain(worker)
    assert [item[0] for item in calls] == ['out(A)', 'out(out(A))']
    assert all(item[1]['model'] == 'frozen-model' and item[1]['temperature'] == .3 and item[1]['api_key'] == 'private-secret' for item in calls)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    run_state = next(item for item in state['runs'] if item['id'] == accepted['run_id'])
    assert run_state['lifecycle'] == 'finished'
    assert all(item['status'] == 'succeeded' for item in run_state['nodes'])
    assert 'private-secret' not in str(state)
    worker.text_pool.shutdown(wait=False)
