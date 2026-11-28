"""Explicit model stages through HTTP, real submission and the actual Worker."""
from tests.canvas_prompt_fixtures import bind_document_prompts
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
    monkeypatch.setattr('app.task_worker.build_langchain_chat', Model)
    worker = TaskWorker(state.sessions)
    doc = deepcopy(state.document)
    doc['cards'] = [{'id': name, 'type': 'model.text', 'model_id': state.model_id,
        'prompt': {'segments': [{'id': 'body' + name, 'kind': 'text', 'text': name}]}} for name in ['A', 'B', 'C', 'X', 'Y']]
    await save(state, bind_document_prompts(doc))
    for name in ['A', 'B', 'C', 'X', 'Y']:
        await run(state, name)
        await drain(worker)
    for source, target in [('A', 'B'), ('B', 'C'), ('X', 'Y')]:
        doc.setdefault('edges', []).append({'id': source + target, 'source_card': source, 'source_port': 'text', 'target_card': target, 'target_port': 'text'})
        doc.setdefault('input_order', {})[target] = {'text': [source + target]}
        card = next(item for item in doc['cards'] if item['id'] == target)
        card['prompt']['segments'] = [{'kind': 'reference', 'id': 'ref' + target,
            'source': {'canvas_id': state.canvas_id, 'card_id': source, 'port_id': 'text', 'position': 0}}]
    await save(state, bind_document_prompts(doc))
    calls.clear()
    return doc, calls, worker


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_single_reuses_valid_upstream_and_freezes_actual_request(runtime, monkeypatch):
    from app.models.llm import Model, Provider
    doc, calls, worker = await chain(runtime, monkeypatch)
    accepted, preview = await run(runtime, 'B')
    assert preview['execution_nodes'] == ['B']
    assert len(preview['reused_results']) == 1
    assert len(accepted['task_ids']) == 1
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    nodes = next(item for item in state['runs'] if item['id'] == accepted['run_id'])['nodes']
    assert {item['card_id']: item['status'] for item in nodes} == {'B': 'queued'}
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
    assert sorted(item[0] for item in calls) == sorted(['out(A)', 'other run A'])
    assert all(item[1]['model'] == 'frozen-model' and item[1]['temperature'] == .3 and item[1]['api_key'] == 'private-secret' for item in calls)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    run_state = next(item for item in state['runs'] if item['id'] == accepted['run_id'])
    assert run_state['lifecycle'] == 'finished'
    assert all(item['status'] == 'succeeded' for item in run_state['nodes'])
    assert 'private-secret' not in str(state)
    worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_cancel_serializes_with_single_node_completion(runtime, monkeypatch):
    from app.services.task_service import TaskService
    _, calls, worker = await chain(runtime, monkeypatch)
    accepted, _ = await run(runtime, 'B')
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(item for item in state['runs'] if item['id'] == accepted['run_id'])['nodes'][0]
    writer = runtime.sessions()
    await TaskService(writer).claim(node['task_id'], worker_id='race')
    await TaskService(writer).finish(node['task_id'], result={'text': 'this run B'})
    cancelling = asyncio.create_task(runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}/nodes/{node['id']}/cancel"))
    await asyncio.sleep(.1)
    assert not cancelling.done()
    await writer.commit()
    await writer.close()
    response = await asyncio.wait_for(cancelling, 5)
    assert response.status_code == 200, response.text
    assert len(response.json()['data']['nodes']) == 1
    assert response.json()['data']['nodes'][0]['status'] == 'succeeded'
    assert (await runtime.client.get(runtime.url + '/runtime')).json()['data']['current_outputs']['C'][0]['text'] == 'out(C)'
    assert calls == []
    worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_missing_positions_block_consumer_and_admitted_files_remain_pinned(runtime, image_storage):
    import base64
    import httpx
    import json
    from app.models.llm import Model
    from app.models.studio import FileItem
    from app.services.studio.file_usages import upsert_file_usage
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.category, model.name = 'image', 'image-model'
        model.capability_profile = {'image_modes': {'edit': {'supported': True}}}
        image_storage['known'] = (b'known', 'image/png', {})
        db.add(FileItem(id='known', name='known', type='image', storage_key='known', content_type='image/png'))
        await db.flush()
        await upsert_file_usage(db, file_id='known', project_id=runtime.project_id, chapter_id=None, usage_kind='upload')
    doc = deepcopy(runtime.document)
    doc['cards'] = [{'id': name, 'type': 'model.image', 'model_id': runtime.model_id,
        'config': {'count': 2, 'target_ratio': '1:1', 'resolution_profile': 'standard'},
        'prompt': {'segments': [{'kind': 'text', 'id': name, 'text': name}]}} for name in ['A', 'B', 'C']]
    await save(runtime, bind_document_prompts(doc))
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
        await save(runtime, bind_document_prompts(doc))
        # Refresh the producer explicitly. Its new single image withdraws position 1.
        await run(runtime, 'A')
        await drain(worker)
        missing = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'B'})).json()['data']
        assert missing['execution_nodes'] == ['B'] and not missing['can_run']
        assert any(item['code'] == 'OUTPUT_MISSING' for item in missing['diagnostics'])
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        assert state['current_outputs']['B'][0]['file_id']
        assert state['current_outputs']['C'][0]['file_id']
        # Rebind a valid current position, then admit B alone. Its known file is
        # pinned by the accepted request even if current edits remove the input.
        doc['cards'][1]['input_bindings'][0]['source']['position'] = 0
        await save(runtime, bind_document_prompts(doc))
        accepted, preview = await run(runtime, 'B')
        assert preview['execution_nodes'] == ['B'] and len(accepted['task_ids']) == 1
        from app.api.v1.routes.studio.files import router as files_router
        runtime.app.include_router(files_router, prefix='/files')
        detail = (await runtime.client.get('/files/known')).json()['data']
        assert any(item['usage_kind'] == 'canvas_run' for item in detail['usages'])
        assert (await runtime.client.delete('/files/known')).status_code == 409
        doc['cards'][1]['prompt']['segments'] = [item for item in doc['cards'][1]['prompt']['segments'] if item['id'] != 'knownRef']
        doc['cards'][1]['input_bindings'] = [item for item in doc['cards'][1]['input_bindings'] if item['id'] != 'input-knownRef']
        doc['cards'] = [item for item in doc['cards'] if item['id'] != 'known']
        doc['edges'] = [item for item in doc['edges'] if item['id'] != 'knownB']
        doc['input_order']['B']['image'].remove('knownB')
        await save(runtime, bind_document_prompts(doc))
        detail = (await runtime.client.get('/files/known')).json()['data']
        assert any(item['usage_kind'] == 'canvas_run' for item in detail['usages'])
        calls.clear()
        await drain(worker)
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        node = next(item for item in state['runs'] if item['id'] == accepted['run_id'])['nodes'][0]
        assert node['card_id'] == 'B' and node['status'] == 'succeeded'
        assert len(calls) == 1 and calls[0].startswith('B')
        missing = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'C'})).json()['data']
        assert not missing['can_run'] and any(item['code'] == 'INPUT_STALE' for item in missing['diagnostics'])
        worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
@pytest.mark.parametrize('outcome', ['failure', 'node_cancel', 'run_cancel', 'interruption'])
async def test_single_terminal_paths_do_not_run_downstream_or_fallback(runtime, monkeypatch, outcome):
    from app.services.task_service import TaskService
    doc, calls, worker = await chain(runtime, monkeypatch)
    doc['cards'][0]['prompt']['segments'][0]['text'] = 'new A'
    doc['cards'][3]['prompt']['segments'][0]['text'] = 'new X'
    await save(runtime, doc)
    accepted, preview = await run(runtime, 'A')
    assert preview['execution_nodes'] == ['A']
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(item for item in state['runs'] if item['id'] == accepted['run_id'])['nodes'][0]
    class Model:
        def __init__(self, **params):
            pass
        async def astream(self, messages):
            text = messages[0].content
            calls.append(text)
            if text == 'new A' and outcome == 'failure':
                raise RuntimeError('controlled provider failure')
            yield SimpleNamespace(content='out(' + text + ')')
    monkeypatch.setattr('app.task_worker.build_langchain_chat', Model)
    if outcome in ('node_cancel', 'run_cancel'):
        suffix = f"/nodes/{node['id']}" if outcome == 'node_cancel' else ''
        response = await runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}" + suffix + '/cancel')
        assert response.status_code == 200, response.text
    elif outcome == 'interruption':
        async with runtime.sessions.begin() as db:
            await TaskService(db).claim(node['task_id'], worker_id='old')
            await TaskService(db).interrupt_previous_workers(worker_id='new')
    await drain(worker)
    for card in ['X', 'Y']:
        await run(runtime, card)
        await drain(worker)
    blocked = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'B'})).json()['data']
    assert not blocked['can_run'] and any(item['code'] == 'INPUT_STALE' for item in blocked['diagnostics'])
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    run_state = next(item for item in state['runs'] if item['id'] == accepted['run_id'])
    assert run_state['lifecycle'] == 'finished' and len(run_state['nodes']) == 1
    assert run_state['nodes'][0]['status'] in ('failed', 'cancelled', 'interrupted')
    assert state['current_outputs']['C'][0]['text'] == 'out(C)'
    assert state['current_outputs']['Y'][0]['text'] == 'out(out(new X))'
    assert not any(item.startswith('out(A)') for item in calls)
    worker.text_pool.shutdown(wait=False)
