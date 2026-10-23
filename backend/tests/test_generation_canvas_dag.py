"""Target execution through HTTP, real submission and the actual Worker."""
from copy import deepcopy
from types import SimpleNamespace
import asyncio
import pytest
from tests.test_generation_canvas_runs import runtime  # noqa: F401
from app.task_worker import TaskWorker
from tests.test_generation_canvas_images import image_storage  # noqa: F401


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
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
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
    doc['cards'][0]['prompt']['segments'][0]['text'] = 'other run A'
    await save(runtime, doc)
    # A is only reused, so another explicit run may execute it. B still uses
    # the original concrete A result admitted by the first run.
    await run(runtime, 'A')
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.name, model.params = 'changed', {'temperature': .9}
        provider = await db.get(Provider, runtime.provider_id)
        provider.api_key, provider.base_url = 'changed', 'https://changed.test'
    await drain(worker)
    assert sorted(item[0] for item in calls) == sorted(['out(A)', 'out(out(A))', 'other run A'])
    assert all(item[1]['model'] == 'frozen-model' and item[1]['temperature'] == .3 and item[1]['api_key'] == 'private-secret' for item in calls)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    run_state = next(item for item in state['runs'] if item['id'] == accepted['run_id'])
    assert run_state['lifecycle'] == 'finished'
    assert all(item['status'] == 'succeeded' for item in run_state['nodes'])
    assert 'private-secret' not in str(state)
    worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_cancel_waiting_node_serializes_with_just_created_downstream_task(runtime, monkeypatch):
    from app.services.task_service import TaskService
    doc, calls, worker = await chain(runtime, monkeypatch)
    doc['cards'][0]['prompt']['segments'][0]['text'] = 'changed A'
    await save(runtime, doc)
    accepted, _ = await run(runtime, 'C', 'target')
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    nodes = {item['card_id']: item for item in next(item for item in state['runs'] if item['id'] == accepted['run_id'])['nodes']}
    writer = runtime.sessions()
    await TaskService(writer).claim(nodes['A']['task_id'], worker_id='race')
    await TaskService(writer).finish(nodes['A']['task_id'], result={'text': 'this run A'})
    # B's new Task exists only in the uncommitted producer transaction. Cancel
    # initially sees B waiting, then must cancel its now-authoritative queued Task.
    cancelling = asyncio.create_task(runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}/nodes/{nodes['B']['id']}/cancel"))
    await asyncio.sleep(.1)
    assert not cancelling.done()
    await writer.commit()
    await writer.close()
    response = await asyncio.wait_for(cancelling, 5)
    assert response.status_code == 200, response.text
    final = {item['card_id']: item for item in response.json()['data']['nodes']}
    assert final['B']['status'] == 'cancelled' and final['B']['task_id']
    assert final['C']['status'] == 'blocked' and final['C']['task_id'] is None
    await drain(worker)
    assert calls == []
    worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_missing_positions_reject_admission_and_new_missing_result_fails_only_downstream(runtime, image_storage):
    import base64
    import httpx
    import json
    from app.models.llm import Model
    from app.models.studio import FileItem
    from app.services.studio.file_usages import upsert_file_usage
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.category, model.name = 'image', 'image-model'
        image_storage['known'] = (b'known', 'image/png', {})
        db.add(FileItem(id='known', name='known', type='image', storage_key='known', content_type='image/png'))
        await db.flush()
        await upsert_file_usage(db, file_id='known', project_id=runtime.project_id, chapter_id=None, usage_kind='upload')
    doc = deepcopy(runtime.document)
    doc['cards'] = [{'id': name, 'type': 'model.image', 'model_id': runtime.model_id,
        'config': {'count': 2, 'target_ratio': '1:1', 'resolution_profile': 'standard'},
        'prompt': {'segments': [{'kind': 'text', 'id': name, 'text': name}]}} for name in ['A', 'B', 'C']]
    await save(runtime, doc)
    calls = []
    def provider(request):
        body = json.loads(request.content)
        calls.append(body['prompt'])
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'image').decode()} for _ in range(body['n'])]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        for name in ['A', 'B', 'C']:
            await run(runtime, name)
            await drain(worker)
        for source, target in [('A', 'B'), ('B', 'C')]:
            doc.setdefault('edges', []).append({'id': source + target, 'source_card': source, 'source_port': 'image', 'target_card': target, 'target_port': 'image'})
            doc.setdefault('input_order', {})[target] = {'image': [source + target]}
            next(item for item in doc['cards'] if item['id'] == target)['prompt']['segments'].append({
                'kind': 'reference', 'id': 'ref' + target,
                'source': {'canvas_id': runtime.canvas_id, 'card_id': source, 'port_id': 'image', 'position': 1}})
        doc['cards'][0]['config']['count'] = 1
        doc['cards'].append({'id': 'known', 'type': 'content.image', 'file_id': 'known'})
        doc['edges'].append({'id': 'knownB', 'source_card': 'known', 'source_port': 'image', 'target_card': 'B', 'target_port': 'image'})
        doc['input_order']['B']['image'].append('knownB')
        doc['cards'][1]['prompt']['segments'].append({'kind': 'reference', 'id': 'knownRef',
            'source': {'canvas_id': runtime.canvas_id, 'card_id': 'known', 'port_id': 'image', 'position': 0}})
        await save(runtime, doc)
        accepted, preview = await run(runtime, 'C', 'target')
        assert preview['execution_nodes'] == ['A', 'B', 'C']
        # File ownership is visible through the real public file endpoint before B has a Task.
        from app.api.v1.routes.studio.files import router as files_router
        runtime.app.include_router(files_router, prefix='/files')
        detail = (await runtime.client.get('/files/known')).json()['data']
        assert any(item['usage_kind'] == 'canvas_run' for item in detail['usages'])
        assert (await runtime.client.delete('/files/known')).status_code == 409
        # The waiting B keeps its known file after subsequent edits remove the
        # corresponding content and reference from the current document.
        doc['cards'][1]['prompt']['segments'] = [item for item in doc['cards'][1]['prompt']['segments'] if item['id'] != 'knownRef']
        doc['cards'] = [item for item in doc['cards'] if item['id'] != 'known']
        doc['edges'] = [item for item in doc['edges'] if item['id'] != 'knownB']
        doc['input_order']['B']['image'].remove('knownB')
        await save(runtime, doc)
        detail = (await runtime.client.get('/files/known')).json()['data']
        assert any(item['usage_kind'] == 'canvas_run' for item in detail['usages'])
        calls.clear()
        await drain(worker)
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        nodes = {item['card_id']: item for item in next(item for item in state['runs'] if item['id'] == accepted['run_id'])['nodes']}
        assert nodes['A']['status'] == 'succeeded'
        assert nodes['B']['status'] == 'failed' and nodes['B']['task_id'] is None
        assert nodes['C']['status'] == 'blocked' and nodes['C']['task_id'] is None
        assert calls == ['A']
        # The referenced missing position cannot be admitted even if A would execute.
        doc['cards'][0]['prompt']['segments'][0]['text'] = 'changed A basis again'
        doc['cards'][1]['prompt']['segments'].append({'kind': 'reference', 'id': 'existing0',
            'source': {'canvas_id': runtime.canvas_id, 'card_id': 'A', 'port_id': 'image', 'position': 0}})
        await save(runtime, doc)
        missing = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'C', 'kind': 'target'})).json()['data']
        assert missing['execution_nodes'] == ['A', 'B', 'C']
        assert not missing['can_run'] and any(item['code'] == 'OUTPUT_MISSING' for item in missing['diagnostics'])
        assert state['current_outputs']['B'][0]['file_id']
        worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
@pytest.mark.parametrize('outcome', ['failure', 'node_cancel', 'run_cancel', 'interruption'])
async def test_target_terminal_paths_end_waiting_without_old_output_fallback(runtime, monkeypatch, outcome):
    from app.services.task_service import TaskService
    doc, calls, worker = await chain(runtime, monkeypatch)
    # Make both producers necessary; Y stays independent of the A→B branch.
    doc['cards'][0]['prompt']['segments'][0]['text'] = 'new A'
    doc['cards'][3]['prompt']['segments'][0]['text'] = 'new X'
    doc['edges'].append({'id': 'YC', 'source_card': 'Y', 'source_port': 'text', 'target_card': 'C', 'target_port': 'text'})
    doc['input_order']['C']['text'].append('YC')
    doc['cards'][2]['prompt']['segments'].append({'kind': 'reference', 'id': 'Yref',
        'source': {'canvas_id': runtime.canvas_id, 'card_id': 'Y', 'port_id': 'text', 'position': 0}})
    await save(runtime, doc)
    accepted, preview = await run(runtime, 'C', 'target')
    assert preview['execution_nodes'] == ['A', 'B', 'X', 'Y', 'C']
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    run_state = next(item for item in state['runs'] if item['id'] == accepted['run_id'])
    nodes = {item['card_id']: item for item in run_state['nodes']}
    class Model:
        def __init__(self, **params):
            pass
        async def astream(self, messages):
            text = messages[0].content
            calls.append(text)
            if text == 'new A' and outcome == 'failure':
                raise RuntimeError('controlled provider failure')
            yield SimpleNamespace(content='out(' + text + ')')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', Model)
    if outcome in ('node_cancel', 'run_cancel'):
        suffix = f"/nodes/{nodes['A']['id']}" if outcome == 'node_cancel' else ''
        response = await runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}" + suffix + '/cancel')
        assert response.status_code == 200, response.text
    elif outcome == 'interruption':
        async with runtime.sessions.begin() as db:
            await TaskService(db).claim(nodes['A']['task_id'], worker_id='old')
            await TaskService(db).interrupt_previous_workers(worker_id='new')
    await drain(worker)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    run_state = next(item for item in state['runs'] if item['id'] == accepted['run_id'])
    nodes = {item['card_id']: item for item in run_state['nodes']}
    assert run_state['lifecycle'] == 'finished'
    assert nodes['C']['status'] == 'blocked' and nodes['C']['task_id'] is None
    assert nodes['B']['status'] in ('blocked', 'cancelled') and nodes['B']['task_id'] is None
    if outcome in ('failure', 'node_cancel'):
        assert nodes['X']['status'] == nodes['Y']['status'] == 'succeeded'
        assert 'out(new X)' in calls
    assert state['current_outputs']['C'][0]['text'] == 'out(C)'
    assert not any(item.startswith('out(A)') for item in calls)
    worker.text_pool.shutdown(wait=False)
