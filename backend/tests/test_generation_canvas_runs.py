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
        db.add(Model(id=model_id, name='frozen-model', category='text', provider_id=provider_id, params={'temperature': 0.3, 'default_headers': {'Authorization': 'Bearer model-private-secret'}}))
    real_app = getattr(request, 'param', None) == 'app-handler'
    if real_app:
        from app.main import app
    else:
        app = FastAPI()
        app.include_router(router, prefix='/canvases')
        from app.api.v1.routes.studio.projects import router as projects_router
        app.include_router(projects_router, prefix='/projects')
    async def database():
        async with sessions() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise
    previous_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    prefix = '/api/v1/studio/generation-canvases' if real_app else '/canvases'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        canvas = (await client.post(f'{prefix}/{project_id}', json={'name': 'run'})).json()['data']
        url = f"{prefix}/{project_id}/{canvas['id']}"
        document = canvas['document']
        document['cards'] = [{'id': 'm', 'type': 'model.text', 'model_id': model_id,
                              'prompt': {'segments': [{'id': 'body', 'kind': 'text', 'text': 'Frozen prompt'}]}}]
        assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})).status_code == 200
        yield SimpleNamespace(client=client, app=app, sessions=sessions, url=url, document=document, canvas_id=canvas['id'], project_id=project_id, provider_id=provider_id, model_id=model_id)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous_overrides)
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
    assert 'model-private-secret' not in str(preview)
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
    assert calls[0]['default_headers']['Authorization'] == 'Bearer model-private-secret'
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
    assert busy.json()['detail']['blocks'] == ['run']
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
    assert (await runtime.client.delete('/projects/' + runtime.project_id)).status_code == 409


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
    runtime.document['cards'].append({'id': 'unused', 'type': 'content.text', 'text': 'Unused candidate'})
    runtime.document['edges'].append({'id': 'unused-edge', 'source_card': 'unused', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'})
    runtime.document['input_order']['consumer']['text'] = ['unused-edge', 'input']
    assert (await runtime.client.put(runtime.url, json={'request_id': 'unused', 'expected_revision': 2, 'document': runtime.document})).status_code == 200
    unchanged = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert unchanged['current_outputs']['consumer'][0]['basis_current']
    runtime.document['cards'][0]['prompt']['segments'][0]['text'] = 'changed source basis'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'change-source', 'expected_revision': 3, 'document': runtime.document})).status_code == 200
    snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert snapshot['current_outputs']['m'][0]['text'] == 'Actual source'
    assert not snapshot['current_outputs']['m'][0]['basis_current']
    assert not snapshot['current_outputs']['consumer'][0]['basis_current']
    stale = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert not stale['can_run'] and any(issue['code'] == 'INPUT_STALE' for issue in stale['diagnostics'])
    worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_mysql_activity_guard_sees_run_committed_after_earlier_read(runtime):
    from fastapi import HTTPException
    from app.services.generation_canvas.store import CanvasStore
    from app.services.generation_canvas.runtime import ensure_project_idle
    deleting = runtime.sessions()
    await CanvasStore(deleting, runtime.project_id).get(runtime.canvas_id)
    await accept(runtime)
    with pytest.raises(HTTPException) as error:
        await CanvasStore(deleting, runtime.project_id).delete(runtime.canvas_id)
    assert error.value.status_code == 409
    await deleting.rollback()
    await CanvasStore(deleting, runtime.project_id).get(runtime.canvas_id)
    with pytest.raises(HTTPException) as error:
        await ensure_project_idle(deleting, runtime.project_id)
    assert error.value.status_code == 409
    await deleting.rollback()
    await deleting.close()


@pytest.mark.asyncio
async def test_runtime_migration_preserves_existing_canvas_observation(tmp_path):
    """An existing document must have an event mutex before its first subscription."""
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from app.models.generation_canvas import GenerationCanvas, CanvasSaveReceipt
    from app.services.generation_canvas.runtime import CanvasRuntime
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/upgrade.db')
    async with engine.begin() as db:
        def migrate(connection):
            Project.__table__.create(connection)
            GenerationCanvas.__table__.create(connection)
            CanvasSaveReceipt.__table__.create(connection)
            connection.execute(Project.__table__.insert().values(id='existing-project', name='existing', style='真人都市'))
            connection.execute(GenerationCanvas.__table__.insert().values(id='existing-canvas', project_id='existing-project', revision=7,
                card_types={}, document={'id': 'existing-canvas', 'project_id': 'existing-project', 'name': 'old'}))
            path = Path(__file__).parents[1] / 'alembic/versions/473ab089b58f_generation_canvas_runtime.py'
            spec = importlib.util.spec_from_file_location('canvas_runtime_migration', path)
            migration = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(migration)
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                snapshot_path = path.with_name('8a10d04c631e_canvas_dag_snapshots.py')
                snapshot_spec = importlib.util.spec_from_file_location('canvas_dag_migration', snapshot_path)
                snapshot_migration = importlib.util.module_from_spec(snapshot_spec)
                snapshot_spec.loader.exec_module(snapshot_migration)
                snapshot_migration.upgrade()
        await db.run_sync(migrate)
    sessions = async_sessionmaker(engine)
    async with sessions.begin() as db:
        snapshot = await CanvasRuntime(db, 'existing-project').snapshot('existing-canvas')
        assert snapshot.cursor == 0 and snapshot.runs == [] and snapshot.current_outputs == {}
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql', 'app-handler'], indirect=True)
async def test_canvas_cancel_running_intent_retains_scope_until_actual_terminal(runtime):
    from app.services.task_service import TaskService
    accepted, _ = await accept(runtime)
    task_id = accepted['task_ids'][0]
    async with runtime.sessions.begin() as db:
        await TaskService(db).claim(task_id, worker_id='cancel-test')
        await TaskService(db).append_canvas_text(task_id, 'Partial text')
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    response = await runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}/nodes/{node['id']}/cancel")
    assert response.status_code == 200, response.text
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] == 'running' and node['stage'] == 'cancelling'
    assert node['basis']['input']['text'] == 'Frozen prompt'
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'm'})).json()['data']
    busy = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'still-busy', 'preview_token': preview['preview_token']})
    assert busy.status_code == 409
    async with runtime.sessions.begin() as db:
        await TaskService(db).finish(task_id, result={'text': 'late result'})
    terminal = (await runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}/cancel")).json()['data']
    assert terminal['nodes'][0]['status'] == 'cancelled'
    assert terminal['nodes'][0]['text'] == 'Partial text'
    assert terminal['nodes'][0]['result_set_id'] is None
    assert terminal['nodes'][0]['outputs'][0]['text'] == 'Partial text'
    await accept(runtime, 'released')


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql', 'app-handler'], indirect=True)
async def test_saved_unfinished_content_has_immutable_origin_and_independent_text(runtime):
    from app.services.task_service import TaskService
    accepted, _ = await accept(runtime)
    async with runtime.sessions.begin() as db:
        service = TaskService(db)
        task_id = accepted['task_ids'][0]
        await service.claim(task_id, worker_id='partial')
        await service.append_canvas_text(task_id, 'Unfinished original')
        await service.finish(task_id, error_code='provider_failed', error='controlled')
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    response = await runtime.client.get(runtime.url + f"/runs/{accepted['run_id']}/nodes/{node['id']}/outputs/0/content")
    assert response.status_code == 200, response.text
    card = response.json()['data']
    assert card['text'] == 'Unfinished original'
    assert card['origin'] == {'canvas_id': runtime.canvas_id, 'run_id': accepted['run_id'], 'node_id': node['id'], 'position': 0, 'incomplete': True}
    # Provenance claims must match the saved historical body, ownership and status.
    from copy import deepcopy
    for index, mutate in enumerate(('body', 'status', 'canvas')):
        forged = deepcopy(card)
        if mutate == 'body':
            forged['text'] = 'Fabricated body'
        elif mutate == 'status':
            forged['origin']['incomplete'] = False
        else:
            forged['origin']['canvas_id'] = 'other-canvas'
        rejected = await runtime.client.put(runtime.url, json={'request_id': f'forged-{index}', 'expected_revision': 1,
            'document': {**runtime.document, 'cards': [*runtime.document['cards'], forged]}})
        assert rejected.status_code == 422
        assert (rejected.json().get('data') or rejected.json().get('detail'))['code'] == 'INVALID_ORIGIN'
    runtime.document['cards'].append(card)
    assert (await runtime.client.put(runtime.url, json={'request_id': 'save-partial', 'expected_revision': 1, 'document': runtime.document})).status_code == 200
    runtime.document['cards'][-1]['text'] = 'Independent edit'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'edit-independent', 'expected_revision': 2, 'document': runtime.document})).status_code == 200
    runtime.document['cards'][-1]['origin']['incomplete'] = False
    tamper = await runtime.client.put(runtime.url, json={'request_id': 'tamper', 'expected_revision': 3, 'document': runtime.document})
    assert tamper.status_code == 422
    assert (tamper.json().get('data') or tamper.json().get('detail'))['code'] == 'IMMUTABLE_ORIGIN'
    history = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert history['runs'][0]['nodes'][0]['text'] == 'Unfinished original'
    assert history['current_outputs'] == {}


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['app-handler'], indirect=True)
async def test_queued_cancel_targets_history_and_structured_errors_after_source_removed(runtime):
    accepted, _ = await accept(runtime)
    snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = snapshot['runs'][0]['nodes'][0]
    invalid = await runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}/nodes/wrong/cancel")
    assert invalid.status_code == 404
    assert invalid.json()['data']['code'] == 'NODE_NOT_FOUND'
    response = await runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}/cancel")
    assert response.status_code == 200
    assert response.json()['data']['nodes'][0]['status'] == 'cancelled'
    removed = {**runtime.document, 'cards': []}
    assert (await runtime.client.put(runtime.url, json={'request_id': 'remove-terminal', 'expected_revision': 1, 'document': removed})).status_code == 200
    history = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert history['runs'][0]['nodes'][0]['id'] == node['id']
    assert history['runs'][0]['nodes'][0]['basis']['input']['text'] == 'Frozen prompt'
    task_page = await runtime.client.get('/api/v1/film/tasks', params={'project_id': runtime.project_id})
    assert task_page.status_code == 200, task_page.text
    source = task_page.json()['data']['items'][0]['source']
    assert source['canvas_id'] == runtime.canvas_id and source['run_id'] == accepted['run_id'] and source['node_id'] == node['id']
    assert 'private-secret' not in str(history) and 'model-private-secret' not in str(history)
    replay = await runtime.client.post(runtime.url + f"/runs/{accepted['run_id']}/nodes/{node['id']}/cancel")
    assert replay.json()['data']['nodes'][0]['status'] == 'cancelled'


@pytest.mark.asyncio
async def test_lost_cancel_response_observes_real_worker_without_reexecution(runtime, monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    calls = []
    class ControlledModel:
        def __init__(self, **_params):
            pass
        async def astream(self, _messages):
            calls.append('one external request')
            yield SimpleNamespace(content='Retained partial')
            started.set()
            await release.wait()
            yield SimpleNamespace(content='Discarded after cancellation')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    accepted, _ = await accept(runtime)
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    await asyncio.wait_for(started.wait(), 3)
    class LostResponse(httpx.ASGITransport):
        async def handle_async_request(self, request):
            await super().handle_async_request(request)
            raise httpx.ReadError('cancel response lost')
    try:
        async with httpx.AsyncClient(transport=LostResponse(app=runtime.app), base_url='http://test') as lossy:
            with pytest.raises(httpx.ReadError):
                await lossy.post(runtime.url + f"/runs/{accepted['run_id']}/cancel")
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        node = state['runs'][0]['nodes'][0]
        assert node['status'] == 'running' and node['stage'] == 'cancelling'
        assert state['runs'][0]['lifecycle'] == 'active'
        preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'm'})).json()['data']
        busy = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'unknown-cancel-overlap', 'preview_token': preview['preview_token']})
        assert busy.status_code == 409
    finally:
        release.set()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    terminal = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert terminal['runs'][0]['nodes'][0]['status'] == 'cancelled'
    assert terminal['runs'][0]['nodes'][0]['text'] == 'Retained partial'
    assert terminal['current_outputs'] == {} and calls == ['one external request']


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_terminal_canonical_text_replay_converges_and_stream_observes_next_run(runtime):
    import json
    from app.services.task_service import TaskService
    from app.services.generation_canvas.stream import stream_events
    accepted, _ = await accept(runtime)
    async with runtime.sessions.begin() as db:
        await TaskService(db).claim(accepted['task_ids'][0], worker_id='canonical')
        await TaskService(db).append_canvas_text(accepted['task_ids'][0], 'Provisional body')
    cut = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['cursor']
    async with runtime.sessions.begin() as db:
        await TaskService(db).finish(accepted['task_ids'][0], result={'text': 'Canonical final body'})
    stream = stream_events(runtime.sessions, runtime.project_id, runtime.canvas_id, cut)
    try:
        terminal = json.loads((await anext(stream)).split('data: ', 1)[1])
        assert terminal['type'] == 'node.finished'
        assert terminal['payload']['node']['text'] == 'Canonical final body'
        assert terminal['payload']['node']['outputs'][0]['text'] == 'Canonical final body'
        finished = json.loads((await anext(stream)).split('data: ', 1)[1])
        assert finished['type'] == 'run.finished'
        second, _ = await accept(runtime, 'second-on-same-stream')
        following = json.loads((await anext(stream)).split('data: ', 1)[1])
        assert following['type'] == 'node.updated' and following['run_id'] == second['run_id']
        snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        assert next(run for run in snapshot['runs'] if run['id'] == accepted['run_id'])['nodes'][0]['text'] == 'Canonical final body'
        assert snapshot['current_outputs']['m'][0]['text'] == 'Canonical final body'
    finally:
        await stream.aclose()


@pytest.mark.asyncio
async def test_bound_creative_basis_runs_through_worker_and_publishes_typed_output(runtime, monkeypatch):
    """公开保存、预检、执行和结果读取共享同一输入绑定。"""
    source = {'canvas_id': runtime.canvas_id, 'card_id': 'basis', 'port_id': 'text', 'position': 0}
    runtime.document['cards'] = [
        {'id': 'basis', 'type': 'content.basis', 'text': '张三望向门口', 'source_locator': '导入段落'},
        {'id': 'm', 'type': 'model.text', 'model_id': runtime.model_id,
         'input_bindings': [{'id': 'selected', 'source': source, 'input_port': 'text'}],
         'prompt': {'segments': [{'id': 'mention', 'kind': 'reference', 'binding_id': 'selected'}]}},
    ]
    runtime.document['edges'] = [{'id': 'edge', 'source_card': 'basis', 'source_port': 'text',
                                  'target_card': 'm', 'target_port': 'text'}]
    runtime.document['input_order'] = {'m': {'text': ['edge']}}
    response = await runtime.client.put(runtime.url, json={'request_id': 'basis', 'expected_revision': 1, 'document': runtime.document})
    assert response.status_code == 200, response.text
    accepted, preview = await accept(runtime, 'bound-run')
    assert preview['input']['text'] == '张三望向门口'
    class FakeModel:
        def __init__(self, **_params):
            pass
        async def astream(self, messages):
            assert messages[0].content == '张三望向门口'
            yield SimpleNamespace(content='门口传来敲门声')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', FakeModel)
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    worker.text_pool.shutdown(wait=False)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    run = next(item for item in state['runs'] if item['id'] == accepted['run_id'])
    assert run['nodes'][0]['status'] == 'succeeded'
    outputs = (await runtime.client.get(runtime.url + '/cards/m/outputs')).json()['data']
    assert outputs['outputs'][0]['payload'] == {'kind': 'text', 'text': '门口传来敲门声'}


@pytest.mark.asyncio
@pytest.mark.parametrize('legacy', [False, True])
async def test_snapshot_keeps_admission_order_when_run_timestamps_tie_and_events_are_pruned(runtime, monkeypatch, legacy):
    """Public snapshots retain accepted order, independently of clock precision or UUID order."""
    from datetime import datetime
    from itertools import count
    from sqlalchemy import delete, select, update
    from app.models.generation_canvas import CanvasEvent, CanvasRun, CanvasRunNode
    ids = count(2**128 - 1, -1)
    monkeypatch.setattr('app.services.generation_canvas.runtime.uuid4', lambda: SimpleNamespace(hex=f'{next(ids):032x}'))
    class FakeModel:
        def __init__(self, **_params):
            pass
        async def astream(self, _messages):
            yield SimpleNamespace(content='first result')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', FakeModel)
    first, _ = await accept(runtime, 'first-in-same-second')
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    worker.text_pool.shutdown(wait=False)
    second, _ = await accept(runtime, 'second-in-same-second')
    assert first['run_id'] > second['run_id'], 'UUID order deliberately opposes admission order'
    # Control the database clock boundary to reproduce second-precision production timestamps.
    async with runtime.sessions.begin() as db:
        await db.execute(update(CanvasRun).where(CanvasRun.canvas_id == runtime.canvas_id)
                         .values(created_at=datetime(2026, 10, 29, 12, 0, 0)))
        if legacy:
            for node in await db.scalars(select(CanvasRunNode).where(CanvasRunNode.canvas_id == runtime.canvas_id)):
                node.execution_snapshot = {key: value for key, value in node.execution_snapshot.items() if key != 'admitted_cursor'}
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert [run['id'] for run in state['runs']] == [first['run_id'], second['run_id']]
    assert state['runs'][-1]['nodes'][0]['status'] == 'queued'
    if legacy:
        return  # Legacy admission order is recoverable only while its events remain.
    async with runtime.sessions.begin() as db:
        await db.execute(delete(CanvasEvent).where(CanvasEvent.canvas_id == runtime.canvas_id))
    recovered = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert [run['id'] for run in recovered['runs']] == [first['run_id'], second['run_id']]
    assert recovered['current_outputs'] == state['current_outputs']


@pytest.mark.asyncio
async def test_task_settlement_rolls_back_with_facts_and_repeated_finish_does_not_publish_twice(runtime):
    """任务、成果、占用和事件同事务回滚；重复终态不重复交付。"""
    from app.services.task_service import TaskService
    from app.services.generation_canvas.runtime import CanvasRuntime
    accepted, _ = await accept(runtime)
    task_id = accepted['task_ids'][0]
    async with runtime.sessions.begin() as db:
        assert await TaskService(db).claim(task_id, worker_id='settlement-test')
    before = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    async with runtime.sessions() as db:
        assert await TaskService(db).finish(task_id, result={'text': 'complete'})
        snapshot = await CanvasRuntime(db, runtime.project_id).snapshot(runtime.canvas_id)
        assert snapshot.runs[0].nodes[0].status == 'succeeded'
        assert snapshot.current_outputs['m'][0].text == 'complete'
        await db.rollback()
    assert (await runtime.client.get(runtime.url + '/runtime')).json()['data'] == before
    # A rolled-back release must not let another run claim the same model.
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'm'})).json()['data']
    conflict = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'still-busy', 'preview_token': preview['preview_token']})
    assert conflict.status_code == 409
    async with runtime.sessions.begin() as db:
        assert await TaskService(db).finish(task_id, result={'text': 'complete'})
    finished = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    async with runtime.sessions.begin() as db:
        repeated = await TaskService(db).finish(task_id, result={'text': 'duplicate'})
        assert repeated.result == {'text': 'complete'}
    assert (await runtime.client.get(runtime.url + '/runtime')).json()['data'] == finished


@pytest.mark.asyncio
@pytest.mark.parametrize('outcome', [{'result': {'text': 'complete'}}, {'error': 'failed'}, {'cancelled': True}])
async def test_repeated_terminal_fact_sync_keeps_results_and_events_unchanged(runtime, outcome):
    from sqlalchemy import select
    from app.models.generation_canvas import CanvasEvent, CanvasResultSet
    from app.services.task_service import TaskService
    from app.services.generation_canvas.settlement import sync_task_fact
    accepted, _ = await accept(runtime)
    async with runtime.sessions.begin() as db:
        service = TaskService(db)
        await service.claim(accepted['task_ids'][0], worker_id='repeat-fact')
        task = await service.finish(accepted['task_ids'][0], **outcome)
        async def facts():
            events = list(await db.scalars(select(CanvasEvent).where(CanvasEvent.canvas_id == runtime.canvas_id).order_by(CanvasEvent.cursor)))
            results = list(await db.scalars(select(CanvasResultSet.id).where(CanvasResultSet.canvas_id == runtime.canvas_id)))
            return [event.envelope for event in events], results
        before = await facts()
        await sync_task_fact(db, task, delta='must not append after terminal')
        assert await facts() == before
        assert len(before[1]) == (1 if 'result' in outcome else 0)
        assert [event['type'] for event in before[0]][-2:] == ['node.finished', 'run.finished']
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert 'must not append' not in state['runs'][0]['nodes'][0]['text']
    await accept(runtime, 'after-repeat')
