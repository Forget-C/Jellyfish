"""Real HTTP, database, submitter and Worker at the agreed execution seam."""
import asyncio
from types import SimpleNamespace
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core.db import Base
from app.dependencies import get_db
from app.models.llm import Model, Provider
from app.models.studio import Project
from app.task_worker import TaskWorker


@pytest_asyncio.fixture
async def runtime(tmp_path, request):
    from app.api.v1.routes.studio.generation_canvases import router
    from app.bootstrap import bootstrap_all_registries
    bootstrap_all_registries()
    from uuid import uuid4
    mysql = getattr(request, 'param', None) == 'mysql'
    suffix = uuid4().hex[:12]
    project_id, provider_id, model_id = ('p-' + suffix, 'provider-' + suffix, 'model-' + suffix)
    if mysql:
        from tests.services.test_task_mysql import isolated_database_url
        engine = create_async_engine(isolated_database_url(), isolation_level='READ COMMITTED')
    else:
        engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/runs.db')
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions.begin() as db:
        db.add(Project(id=project_id, name='project', style='真人都市'))
        db.add(Provider(id=provider_id, name='openai', api_key='private-secret', base_url='https://frozen.test/v1'))
        await db.flush()
        db.add(Model(id=model_id, name='frozen-model', category='text', provider_id=provider_id, params={'temperature': 0.3}))
    app = FastAPI()
    app.include_router(router, prefix='/canvases')
    async def database():
        async with sessions() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise
    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        canvas = (await client.post(f'/canvases/{project_id}', json={'name': 'run'})).json()['data']
        url = f"/canvases/{project_id}/{canvas['id']}"
        document = canvas['document']
        document['cards'] = [{'id': 'm', 'type': 'model.text', 'model_id': model_id,
                              'prompt': {'segments': [{'id': 'body', 'kind': 'text', 'text': 'Frozen prompt'}]}}]
        assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})).status_code == 200
        yield SimpleNamespace(client=client, sessions=sessions, url=url, document=document, canvas_id=canvas['id'], project_id=project_id, provider_id=provider_id, model_id=model_id)
    if mysql:
        from sqlalchemy import delete
        from app.models.generation_canvas import CanvasSaveReceipt, GenerationCanvas
        from app.services.generation_canvas.runtime import delete_runtime
        async with sessions.begin() as db:
            await delete_runtime(db, canvas['id'])
            await db.execute(delete(CanvasSaveReceipt).where(CanvasSaveReceipt.canvas_id == canvas['id']))
            await db.execute(delete(GenerationCanvas).where(GenerationCanvas.id == canvas['id']))
            from app.models.task import Task
            await db.execute(delete(Task).where(Task.project_id == project_id))
            await db.execute(delete(Model).where(Model.id == model_id))
            await db.execute(delete(Provider).where(Provider.id == provider_id))
            await db.execute(delete(Project).where(Project.id == project_id))
    await engine.dispose()


async def accept(runtime, request_id='run'):
    preview = await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'm'})
    assert preview.status_code == 200, preview.text
    body = preview.json()['data']
    assert body['can_run'], body
    response = await runtime.client.post(runtime.url + '/runs', json={'request_id': request_id, 'preview_token': body['preview_token']})
    assert response.status_code == 200, response.text
    return response.json()['data'], body


@pytest.mark.asyncio
async def test_frozen_text_stream_persists_partial_then_publishes_only_complete_result(runtime, monkeypatch):
    accepted, preview = await accept(runtime)
    assert 'private-secret' not in str(preview)
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.name, model.params = 'changed-model', {'temperature': 0.9}
        provider = await db.get(Provider, runtime.provider_id)
        provider.base_url, provider.api_key = 'https://changed.test', 'changed-secret'
    calls = []
    class FakeModel:
        def __init__(self, **params):
            calls.append(params)
        async def astream(self, messages):
            assert messages[0].content == 'Frozen prompt'
            yield SimpleNamespace(content='First ')
            state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
            assert state['runs'][0]['nodes'][0]['text'] == 'First '
            assert state['current_outputs'] == {}
            yield SimpleNamespace(content='second')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', FakeModel)
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1
    assert calls[0]['model'] == 'frozen-model'
    assert calls[0]['temperature'] == 0.3
    assert calls[0]['base_url'] == 'https://frozen.test/v1'
    assert calls[0]['api_key'] == 'private-secret'
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['task_id'] == accepted['task_ids'][0]
    assert node['status'] == 'succeeded'
    assert node['text'] == 'First second'
    assert node['result_set_id']
    assert state['current_outputs'] == {}
    assert (await runtime.client.get(runtime.url)).json()['data']['revision'] == 1
    assert 'private-secret' not in str(state)


@pytest.mark.asyncio
async def test_success_current_output_receipt_replay_and_failure_keep_prior_publication(runtime, monkeypatch):
    accepted, preview = await accept(runtime)
    request = {'request_id': 'run', 'preview_token': preview['preview_token']}
    busy = await runtime.client.post(runtime.url + '/runs', json={**request, 'request_id': 'overlap'})
    assert busy.status_code == 409 and busy.json()['detail']['code'] == 'RUN_SCOPE_BUSY'
    class GoodModel:
        def __init__(self, **params):
            assert params['max_retries'] == 0
        async def astream(self, messages):
            yield SimpleNamespace(content='Complete output')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', GoodModel)
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['current_outputs']['m'][0]['text'] == 'Complete output'
    assert state['runs'][0]['nodes'][0]['current_output_updated']
    # Changing only a name advances revision but does not change effective input.
    runtime.document['name'] = 'renamed'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'rename', 'expected_revision': 1, 'document': runtime.document})).status_code == 200
    replay = await runtime.client.post(runtime.url + '/runs', json=request)
    assert replay.json()['data'] == accepted
    assert (await runtime.client.post(runtime.url + '/runs', json={**request, 'preview_token': 'different'})).status_code == 409
    assert (await runtime.client.post(runtime.url + '/runs', json={**request, 'request_id': 'stale'})).json()['detail']['code'] == 'PREVIEW_STALE'
    await accept(runtime, 'second')
    calls = []
    class FailingModel:
        def __init__(self, **params):
            assert params['max_retries'] == 0
        async def astream(self, messages):
            calls.append('provider request')
            yield SimpleNamespace(content='Incomplete')
            raise httpx.ReadError('acceptance unknown')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', FailingModel)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    await worker.tick()
    assert calls == ['provider request']
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['current_outputs']['m'][0]['text'] == 'Complete output'
    failed = next(node for run in state['runs'] for node in run['nodes'] if node['status'] == 'failed')
    assert failed['text'] == 'Incomplete'
    assert failed['outputs'][0]['text'] == 'Incomplete'
    assert failed['result_set_id'] is None
    assert all(run['lifecycle'] == 'finished' for run in state['runs'])
    worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_activity_guards_allow_edits_but_reject_card_canvas_project_deletion(runtime):
    await accept(runtime)
    changed = {**runtime.document, 'cards': []}
    response = await runtime.client.put(runtime.url, json={'request_id': 'delete-card', 'expected_revision': 1, 'document': changed})
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'RUN_SCOPE_BUSY'
    assert (await runtime.client.delete(runtime.url)).status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize('terminal', ['queued_cancel', 'running_cancel', 'failure', 'expiry', 'interruption'])
async def test_every_task_terminal_path_finishes_canvas_and_releases_scope(runtime, terminal, monkeypatch):
    from app.services.task_service import TaskService, utcnow
    from datetime import timedelta
    accepted, _ = await accept(runtime)
    task_id = accepted['task_ids'][0]
    async with runtime.sessions.begin() as db:
        service = TaskService(db)
        if terminal != 'queued_cancel':
            assert await service.claim(task_id, worker_id='old-worker')
        if terminal in ('queued_cancel', 'running_cancel'):
            await service.request_cancel(task_id)
            if terminal == 'running_cancel':
                await service.finish(task_id, result={'text': 'late result'})
        elif terminal == 'failure':
            await service.finish(task_id, error_code='expected_failure', error='controlled')
        elif terminal == 'expiry':
            now = utcnow() + timedelta(days=2)
            monkeypatch.setattr('app.services.task_service.utcnow', lambda: now)
            await service.expire_tasks()
        else:
            await service.interrupt_previous_workers(worker_id='new-worker')
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] in ('failed', 'cancelled')
    assert state['runs'][0]['lifecycle'] == 'finished'
    assert node['result_set_id'] is None and state['current_outputs'] == {}
    await accept(runtime, 'after-terminal')


@pytest.mark.asyncio
async def test_related_edit_keeps_completed_text_only_in_history(runtime, monkeypatch):
    await accept(runtime)
    changed = {**runtime.document, 'cards': [{**runtime.document['cards'][0],
        'prompt': {'segments': [{'id': 'new', 'kind': 'text', 'text': 'New prompt'}]}}]}
    assert (await runtime.client.put(runtime.url, json={'request_id': 'edit', 'expected_revision': 1, 'document': changed})).status_code == 200
    class FakeModel:
        def __init__(self, **_params):
            pass
        async def astream(self, messages):
            assert messages[0].content == 'Frozen prompt'
            yield SimpleNamespace(content='Historical result')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', FakeModel)
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['runs'][0]['nodes'][0]['result_set_id']
    assert not state['runs'][0]['nodes'][0]['current_output_updated']
    assert state['current_outputs'] == {}
    worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_mysql_same_receipt_and_overlap_admission_are_atomic(runtime):
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'm'})).json()['data']
    body = {'request_id': 'raced', 'preview_token': preview['preview_token']}
    responses = await asyncio.gather(*(runtime.client.post(runtime.url + '/runs', json=body) for _ in range(5)))
    assert all(response.status_code == 200 for response in responses), [response.text for response in responses]
    accepted = responses[0].json()['data']
    assert all(response.json()['data'] == accepted for response in responses)
    overlaps = await asyncio.gather(*(runtime.client.post(runtime.url + '/runs', json={**body, 'request_id': f'independent-{i}'}) for i in range(4)))
    assert all(response.status_code == 409 and response.json()['detail']['code'] == 'RUN_SCOPE_BUSY' for response in overlaps)
    snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert len(snapshot['runs']) == 1 and len(snapshot['runs'][0]['nodes']) == 1
    assert snapshot['cursor'] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_mysql_snapshot_waits_for_committed_text_and_replay_follows_consistent_cut(runtime):
    from app.services.task_service import TaskService
    from app.services.generation_canvas.stream import stream_events
    accepted, _ = await accept(runtime)
    task_id = accepted['task_ids'][0]
    async with runtime.sessions.begin() as db:
        assert await TaskService(db).claim(task_id, worker_id='stream-worker')
    writer = runtime.sessions()
    await TaskService(writer).append_canvas_text(task_id, 'committed-first')
    snapshot_future = asyncio.create_task(runtime.client.get(runtime.url + '/runtime'))
    await asyncio.sleep(.1)
    assert not snapshot_future.done()  # head lock prevents an inconsistent cursor/facts cut
    await writer.commit()
    await writer.close()
    snapshot = (await snapshot_future).json()['data']
    assert snapshot['runs'][0]['nodes'][0]['text'] == 'committed-first'
    cursor = snapshot['cursor']
    async with runtime.sessions.begin() as db:
        await TaskService(db).append_canvas_text(task_id, '-second')
    stream = stream_events(runtime.sessions, runtime.project_id, runtime.canvas_id, cursor)
    event = await anext(stream)
    await stream.aclose()
    assert 'text.delta' in event and '-second' in event
    assert f'id: {cursor + 1}\n' in event
    # Future/expired cursors recover with an authoritative snapshot, never generation.
    stream = stream_events(runtime.sessions, runtime.project_id, runtime.canvas_id, cursor + 1000)
    reset = await anext(stream)
    await stream.aclose()
    assert 'event: snapshot' in reset and 'committed-first-second' in reset


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_mysql_distinct_tasks_serialize_canvas_event_commit_order(runtime):
    from app.services.task_service import TaskService
    from app.services.generation_canvas.stream import stream_events
    second_card = {**runtime.document['cards'][0], 'id': 'second'}
    runtime.document['cards'].append(second_card)
    assert (await runtime.client.put(runtime.url, json={'request_id': 'second-card', 'expected_revision': 1, 'document': runtime.document})).status_code == 200
    first, _ = await accept(runtime, 'first-run')
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'second'})).json()['data']
    second = (await runtime.client.post(runtime.url + '/runs', json={'request_id': 'second-run', 'preview_token': preview['preview_token']})).json()['data']
    async with runtime.sessions.begin() as db:
        for task_id in first['task_ids'] + second['task_ids']:
            assert await TaskService(db).claim(task_id, worker_id='worker')
    cut = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['cursor']
    first_writer, second_writer = runtime.sessions(), runtime.sessions()
    await TaskService(first_writer).append_canvas_text(first['task_ids'][0], 'first-commit')
    later = asyncio.create_task(TaskService(second_writer).append_canvas_text(second['task_ids'][0], 'second-commit'))
    await asyncio.sleep(.1)
    assert not later.done()
    await first_writer.commit()
    assert await later
    await second_writer.commit()
    await first_writer.close()
    await second_writer.close()
    stream = stream_events(runtime.sessions, runtime.project_id, runtime.canvas_id, cut)
    events = [await anext(stream), await anext(stream)]
    await stream.aclose()
    assert f'id: {cut + 1}\n' in events[0] and 'first-commit' in events[0]
    assert f'id: {cut + 2}\n' in events[1] and 'second-commit' in events[1]


@pytest.mark.asyncio
async def test_single_card_uses_published_input_without_executing_upstream_and_rejects_stale_input(runtime, monkeypatch):
    calls = []
    class FakeModel:
        def __init__(self, **_params):
            pass
        async def astream(self, messages):
            calls.append(messages[0].content)
            yield SimpleNamespace(content='Actual source')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', FakeModel)
    worker = TaskWorker(runtime.sessions)
    await accept(runtime)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    source = {'canvas_id': runtime.canvas_id, 'card_id': 'm', 'port_id': 'text', 'position': 0}
    runtime.document['cards'].append({'id': 'consumer', 'type': 'model.text', 'model_id': runtime.model_id,
        'prompt': {'segments': [{'kind': 'reference', 'id': 'ref', 'source': source}]}})
    runtime.document['edges'] = [{'id': 'input', 'source_card': 'm', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}]
    runtime.document['input_order'] = {'consumer': {'text': ['input']}}
    assert (await runtime.client.put(runtime.url, json={'request_id': 'consumer', 'expected_revision': 1, 'document': runtime.document})).status_code == 200
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'] and preview['execution_nodes'] == ['consumer']
    assert preview['input']['text'] == 'Actual source'
    assert preview['input']['used'][0]['result_set_id']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'consume', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    assert calls == ['Frozen prompt', 'Actual source']
    runtime.document['cards'][0]['prompt']['segments'][0]['text'] = 'changed source basis'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'change-source', 'expected_revision': 2, 'document': runtime.document})).status_code == 200
    snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert snapshot['current_outputs']['m'][0]['text'] == 'Actual source'
    assert not snapshot['current_outputs']['m'][0]['basis_current']
    assert not snapshot['current_outputs']['consumer'][0]['basis_current']
    stale = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert not stale['can_run'] and any(issue['code'] == 'INPUT_STALE' for issue in stale['diagnostics'])
    worker.text_pool.shutdown(wait=False)
