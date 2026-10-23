"""Strict selected scope through HTTP and the real Task execution boundary."""
import pytest
from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_dag import chain, save, drain, run


async def selection(state, ids):
    response = await state.client.post(state.url + '/precheck', json={
        'card_id': ids[0], 'kind': 'selection', 'card_ids': ids})
    assert response.status_code == 200, response.text
    return response.json()['data']


@pytest.mark.asyncio
async def test_selection_requires_omitted_middle_and_executes_every_selected_model_once(runtime, monkeypatch):
    doc, calls, worker = await chain(runtime, monkeypatch)
    for name in ['B', 'C']:
        await run(runtime, name)
        await drain(worker)
    calls.clear()
    missing = await selection(runtime, ['A', 'C'])
    assert missing['execution_nodes'] == ['A', 'C']
    assert not missing['can_run'] and missing['preview_token'] is None
    assert any(issue['code'] == 'SELECTION_INCOMPLETE' and issue['target']['card_id'] == 'B'
               for issue in missing['diagnostics'])
    doc['cards'].append({'id': 'note', 'type': 'content.text', 'text': 'not executable'})
    doc['groups'] = [{'id': 'group', 'name': 'organize', 'card_ids': ['A', 'B', 'C']}]
    await save(runtime, doc)
    preview = await selection(runtime, ['C', 'A', 'note', 'group', 'B', 'X', 'X'])
    assert preview['can_run'], preview
    assert preview['execution_nodes'] == ['A', 'B', 'C', 'X']
    accepted = await runtime.client.post(runtime.url + '/runs', json={
        'request_id': 'strict-selection', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    await drain(worker)
    assert sorted(text for text, _ in calls) == ['A', 'X', 'out(A)', 'out(out(A))']
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    active = next(item for item in state['runs'] if item['id'] == accepted.json()['data']['run_id'])
    assert len(active['nodes']) == 4 and all(item['status'] == 'succeeded' for item in active['nodes'])
    assert not state['current_outputs']['Y'][0]['basis_current']
    worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_selection_keeps_external_stale_or_missing_inputs_blocked(runtime, monkeypatch):
    doc, calls, worker = await chain(runtime, monkeypatch)
    stale = await selection(runtime, ['C'])
    assert not stale['can_run'] and stale['execution_nodes'] == ['C']
    assert any(issue['code'] == 'INPUT_STALE' and issue['target']['card_id'] == 'B'
               for issue in stale['diagnostics'])
    doc['cards'][2]['prompt']['segments'][0]['source']['position'] = 3
    await save(runtime, doc)
    missing = await selection(runtime, ['A', 'B', 'C'])
    assert not missing['can_run'] and missing['preview_token'] is None
    assert any(issue['code'] == 'OUTPUT_MISSING' for issue in missing['diagnostics'])
    assert calls == []
    empty = await runtime.client.post(runtime.url + '/precheck', json={
        'card_id': 'not-a-model', 'kind': 'selection', 'card_ids': []})
    assert empty.status_code == 422
    worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_mysql_atomic_selection_conflict_shared_reads_parallel_and_cancel_hold(runtime, monkeypatch):
    import asyncio
    from copy import deepcopy
    from types import SimpleNamespace
    from app.task_worker import TaskWorker
    from app.services.generation_canvas.stream import stream_events
    import json
    doc, calls, worker = await chain(runtime, monkeypatch)
    sibling = deepcopy(doc['cards'][1])
    sibling['id'] = 'D'
    doc['cards'].append(sibling)
    doc['edges'].append({'id': 'AD', 'source_card': 'A', 'source_port': 'text', 'target_card': 'D', 'target_port': 'text'})
    doc['input_order']['D'] = {'text': ['AD']}
    await save(runtime, doc)
    worker.text_pool.shutdown(wait=False)
    first_preview, sibling_preview = await asyncio.gather(selection(runtime, ['B']), selection(runtime, ['D']))
    assert first_preview['can_run'] and sibling_preview['can_run']
    async def submit(preview, request_id):
        return await runtime.client.post(runtime.url + '/runs', json={
            'request_id': request_id, 'preview_token': preview['preview_token']})
    first, overlap, sibling_run = await asyncio.gather(submit(first_preview, 'race-first'),
        submit(first_preview, 'race-overlap'), submit(sibling_preview, 'race-sibling'))
    assert sorted([first.status_code, overlap.status_code]) == [200, 409]
    assert sibling_run.status_code == 200, sibling_run.text
    accepted, rejected = (first, overlap) if first.status_code == 200 else (overlap, first)
    accepted, sibling_run = accepted.json()['data'], sibling_run.json()['data']
    detail = rejected.json().get('data') or rejected.json()['detail']
    assert detail['code'] == 'RUN_SCOPE_BUSY'
    assert detail['target']['card_id'] == 'B' and detail['target']['run_id'] == accepted['run_id']
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    observed = {run['id']: run for run in state['runs']}
    assert observed[accepted['run_id']]['nodes'][0]['task_id']
    assert observed[sibling_run['run_id']]['nodes'][0]['task_id']
    assert len(accepted['task_ids']) == len(sibling_run['task_ids']) == 1
    started, release = asyncio.Event(), asyncio.Event()
    requests = []
    class ControlledModel:
        def __init__(self, **_params):
            pass
        async def astream(self, messages):
            requests.append(messages[0].content)
            yield SimpleNamespace(content='partial')
            if len(requests) == 2:
                started.set()
            await release.wait()
            yield SimpleNamespace(content=' final')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    try:
        await asyncio.wait_for(started.wait(), 5)
        cancelled = await runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}/cancel")
        assert cancelled.status_code == 200
        assert cancelled.json()['data']['nodes'][0]['stage'] == 'cancelling'
        held = await submit(first_preview, 'after-intent')
        assert held.status_code == 409
        assert (held.json().get('data') or held.json()['detail'])['code'] == 'RUN_SCOPE_BUSY'
        independent = await selection(runtime, ['A', 'X'])
        assert independent['can_run']
        other = await submit(independent, 'independent')
        assert other.status_code == 200 and len(other.json()['data']['task_ids']) == 2
    finally:
        release.set()
        await asyncio.gather(*worker.jobs.values())
        await drain(worker)
        worker.text_pool.shutdown(wait=False)
    assert requests.count('out(A)') == 2
    final = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert all(run['lifecycle'] == 'finished' for run in final['runs'])
    assert next(run for run in final['runs'] if run['id'] == sibling_run['run_id'])['nodes'][0]['text'] == 'partial final'
    stream = stream_events(runtime.sessions, runtime.project_id, runtime.canvas_id, state['cursor'])
    events = []
    try:
        while len([event for event in events if event['type'] == 'run.finished']) < 3:
            chunk = await asyncio.wait_for(anext(stream), 3)
            if chunk.startswith('id:'):
                events.append(json.loads(chunk.split('data: ', 1)[1]))
    finally:
        await stream.aclose()
    cursors = [event['cursor'] for event in events]
    assert cursors == sorted(set(cursors))
    assert {event['run_id'] for event in events if event['type'] == 'run.finished'} == {
        accepted['run_id'], sibling_run['run_id'], other.json()['data']['run_id']}
    fresh = await selection(runtime, ['B'])
    assert fresh['can_run']
    again = await submit(fresh, 'explicit-after-terminal')
    assert again.status_code == 200
    await runtime.client.post(runtime.url + '/runs/' + again.json()['data']['run_id'] + '/cancel')


@pytest.mark.asyncio
async def test_selection_publication_stream_marks_unexecuted_downstream_stale(runtime, monkeypatch):
    import json
    from app.services.generation_canvas.stream import stream_events
    doc, calls, worker = await chain(runtime, monkeypatch)
    for name in ['B', 'C']:
        await run(runtime, name)
        await drain(worker)
    before = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert before['current_outputs']['C'][0]['basis_current']
    calls.clear()
    preview = await selection(runtime, ['A'])
    accepted = (await runtime.client.post(runtime.url + '/runs', json={
        'request_id': 'source-only', 'preview_token': preview['preview_token']})).json()['data']
    await drain(worker)
    stream = stream_events(runtime.sessions, runtime.project_id, runtime.canvas_id, before['cursor'])
    try:
        while True:
            event = json.loads((await anext(stream)).split('data: ', 1)[1])
            if event['type'] == 'node.finished' and event['run_id'] == accepted['run_id']:
                assert not event['payload']['current_outputs']['B'][0]['basis_current']
                assert not event['payload']['current_outputs']['C'][0]['basis_current']
                break
    finally:
        await stream.aclose()
        worker.text_pool.shutdown(wait=False)
    assert [text for text, _ in calls] == ['A']


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
@pytest.mark.parametrize('operation', ['save', 'precheck', 'submit'])
async def test_real_http_success_waits_for_canvas_transaction_commit(runtime, operation):
    """A received success must already be visible to the next HTTP connection."""
    import asyncio
    import socket
    import httpx
    import uvicorn
    from app.dependencies import get_db
    ready, release = asyncio.Event(), asyncio.Event()
    preview = await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'm'})
    token = preview.json()['data']['preview_token']
    async def controlled_commit():
        async with runtime.sessions() as db:
            try:
                yield db
                ready.set()
                await release.wait()
                await db.commit()
            except Exception:
                await db.rollback()
                raise
    previous = runtime.app.dependency_overrides[get_db]
    runtime.app.dependency_overrides[get_db] = controlled_commit
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    server = uvicorn.Server(uvicorn.Config(runtime.app, log_level='error', lifespan='off'))
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    request = None
    try:
        while not server.started:
            await asyncio.sleep(.01)
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{listener.getsockname()[1]}') as client:
            if operation == 'save':
                request = asyncio.create_task(client.put(runtime.url, json={'request_id': 'http-commit',
                    'expected_revision': 1, 'document': runtime.document}))
            elif operation == 'precheck':
                request = asyncio.create_task(client.post(runtime.url + '/precheck', json={'card_id': 'm'}))
            else:
                request = asyncio.create_task(client.post(runtime.url + '/runs', json={
                    'request_id': 'http-commit', 'preview_token': token}))
            try:
                await asyncio.wait_for(ready.wait(), 3)
                await asyncio.sleep(.05)
                assert not request.done(), 'success escaped before durable commit'
            finally:
                release.set()
                response = await request
            assert response.status_code == 200, response.text
            # Remove the test barrier, then prove another HTTP connection can use the receipt immediately.
            runtime.app.dependency_overrides[get_db] = previous
            if operation == 'save':
                assert (await client.get(runtime.url)).json()['data']['revision'] == 2
            elif operation == 'precheck':
                accepted = await client.post(runtime.url + '/runs', json={
                    'request_id': 'use-preview-immediately', 'preview_token': response.json()['data']['preview_token']})
                assert accepted.status_code == 200, accepted.text
            else:
                state = (await client.get(runtime.url + '/runtime')).json()['data']
                assert response.json()['data']['run_id'] in {run['id'] for run in state['runs']}
    finally:
        release.set()
        if request:
            await asyncio.gather(request, return_exceptions=True)
        runtime.app.dependency_overrides[get_db] = previous
        server.should_exit = True
        await serving
        listener.close()
