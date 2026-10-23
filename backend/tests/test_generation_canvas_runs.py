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
async def runtime(tmp_path):
    from app.api.v1.routes.studio.generation_canvases import router
    from app.bootstrap import bootstrap_all_registries
    bootstrap_all_registries()
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/runs.db')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions.begin() as db:
        db.add(Project(id='p', name='project', style='真人都市'))
        db.add(Provider(id='provider', name='openai', api_key='private-secret', base_url='https://frozen.test/v1'))
        await db.flush()
        db.add(Model(id='text-model', name='frozen-model', category='text', provider_id='provider', params={'temperature': 0.3}))
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
        canvas = (await client.post('/canvases/p', json={'name': 'run'})).json()['data']
        url = f"/canvases/p/{canvas['id']}"
        document = canvas['document']
        document['cards'] = [{'id': 'm', 'type': 'model.text', 'model_id': 'text-model',
                              'prompt': {'segments': [{'id': 'body', 'kind': 'text', 'text': 'Frozen prompt'}]}}]
        assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})).status_code == 200
        yield SimpleNamespace(client=client, sessions=sessions, url=url, document=document, canvas_id=canvas['id'])
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
        model = await db.get(Model, 'text-model')
        model.name, model.params = 'changed-model', {'temperature': 0.9}
        provider = await db.get(Provider, 'provider')
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
