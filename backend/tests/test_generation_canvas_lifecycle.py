"""Public file/canvas deletion through actual media generation and history."""
import asyncio
import base64
import httpx
import pytest
from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage, image_card, accept  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', [None, 'mysql'], indirect=True)
@pytest.mark.parametrize('incomplete', [False, True])
async def test_deleted_cards_keep_history_and_canvas_deletion_releases_only_its_files(runtime, image_storage, incomplete):
    from app.api.v1.routes.studio.files import router
    runtime.app.include_router(router, prefix='/files')
    await image_card(runtime, count=3 if incomplete else 2)
    accepted, _ = await accept(runtime)
    from app.task_worker import TaskWorker
    def provider(request):
        if request.method == 'GET':
            return httpx.Response(503) if request.url.path == '/2' else httpx.Response(200, content=b'first' if request.url.path == '/0' else b'second', headers={'Content-Type': 'image/png'})
        data = [{'url': 'https://media.test/' + str(index)} for index in range(3)] if incomplete else [
            {'b64_json': base64.b64encode(value).decode()} for value in (b'first', b'second')]
        return httpx.Response(200, json={'data': data})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(run for run in snapshot['runs'] if run['id'] == accepted['run_id'])['nodes'][0]
    assert node['status'] == ('failed' if incomplete else 'succeeded')
    first, second = [output['file_id'] for output in node['outputs']]
    other = (await runtime.client.post('/canvases/' + runtime.project_id, json={'name': 'independent'})).json()['data']
    other_url = '/canvases/' + runtime.project_id + '/' + other['id']
    other['document']['cards'] = [{'id': 'independent', 'type': 'content.image', 'file_id': first}]
    saved = await runtime.client.put(other_url, json={'request_id': 'retain', 'expected_revision': 0, 'document': other['document']})
    assert saved.status_code == 200, saved.text
    runtime.document['cards'] = []
    saved = await runtime.client.put(runtime.url, json={'request_id': 'delete-card', 'expected_revision': 2, 'document': runtime.document})
    assert saved.status_code == 200, saved.text
    history = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['runs']
    assert next(run for run in history if run['id'] == accepted['run_id'])['nodes'][0]['outputs'] == node['outputs']
    assert (await runtime.client.get('/files/' + second + '/download')).content == b'second'
    assert (await runtime.client.delete('/files/' + second)).status_code == 409
    assert (await runtime.client.delete(runtime.url, params={'expected_revision': 3})).status_code == 200
    assert (await runtime.client.get(runtime.url + '/runtime')).status_code == 404
    assert (await runtime.client.delete('/files/' + second)).status_code == 200
    assert (await runtime.client.delete('/files/' + first)).status_code == 409
    assert (await runtime.client.get('/files/' + first + '/download')).content == b'first'
    assert (await runtime.client.get(other_url)).json()['data']['document']['cards'][0]['file_id'] == first
    assert (await runtime.client.delete(other_url, params={'expected_revision': 1})).status_code == 200
    assert (await runtime.client.delete('/files/' + first)).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
async def test_project_deletion_cleans_canvas_history_but_keeps_other_project_content(runtime, image_storage):
    from app.api.v1.routes.studio.files import router
    runtime.app.include_router(router, prefix='/files')
    await image_card(runtime, count=1)
    accepted, _ = await accept(runtime)
    from app.task_worker import TaskWorker
    def provider(_request):
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'project-image').decode()}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(run for run in state['runs'] if run['id'] == accepted['run_id'])['nodes'][0]
    file_id = node['outputs'][0]['file_id']
    other_project = runtime.project_id + '-other'
    created = await runtime.client.post('/projects', json={'id': other_project, 'name': 'other', 'style': '真人都市'})
    assert created.status_code == 201, created.text
    retained = await runtime.client.patch('/files/' + file_id, json={'usage': {'project_id': other_project, 'usage_kind': 'asset_image', 'source_ref': 'independent'}})
    assert retained.status_code == 200, retained.text
    assert (await runtime.client.delete('/projects/' + runtime.project_id)).status_code == 200
    assert (await runtime.client.get(runtime.url)).status_code == 404
    assert (await runtime.client.delete('/files/' + file_id)).status_code == 409
    assert (await runtime.client.get('/files/' + file_id + '/download')).content == b'project-image'
    assert (await runtime.client.delete('/projects/' + other_project)).status_code == 200
    assert (await runtime.client.delete('/files/' + file_id)).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', [None, 'mysql'], indirect=True)
async def test_single_consumer_retains_uploaded_input_until_canvas_history_removed(runtime, image_storage):
    from copy import deepcopy
    from app.api.v1.routes.studio.files import router
    from app.task_worker import TaskWorker
    from tests.test_generation_canvas_dag import save, run, drain
    runtime.app.include_router(router, prefix='/files')
    uploaded = await runtime.client.post('/files/upload', files={'file': ('known.png', b'known', 'image/png')},
        data={'project_id': runtime.project_id, 'usage_kind': 'generation_upload'})
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()['data']['id']
    await image_card(runtime, count=1)
    def provider(_request):
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'image').decode()}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await accept(runtime)
        await drain(worker)
        doc = deepcopy(runtime.document)
        doc['cards'][0]['prompt']['segments'][0]['text'] = 'changed upstream'
        doc['cards'] += [
            {'id': 'known', 'type': 'content.image', 'file_id': file_id},
            {'id': 'B', 'type': 'model.image', 'model_id': runtime.model_id, 'config': {'count': 1},
             'prompt': {'segments': [{'kind': 'reference', 'id': 'ref-' + source,
                'source': {'canvas_id': runtime.canvas_id, 'card_id': source, 'port_id': 'image', 'position': 0}}
                for source in ('image', 'known')]}}]
        doc['edges'] = [{'id': source + '-B', 'source_card': source, 'source_port': 'image', 'target_card': 'B', 'target_port': 'image'} for source in ('image', 'known')]
        doc['input_order'] = {'B': {'image': ['image-B', 'known-B']}}
        await save(runtime, doc)
        await run(runtime, 'image')
        await drain(worker)
        accepted, _ = await run(runtime, 'B')
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        nodes = next(item for item in state['runs'] if item['id'] == accepted['run_id'])['nodes']
        waiting = next(item for item in nodes if item['card_id'] == 'B')
        assert waiting['status'] == 'queued' and waiting['task_id']
        # The explicitly admitted consumer pins its actual uploaded input.
        detail = (await runtime.client.get('/files/' + file_id)).json()['data']
        assert {'generation_upload', 'canvas_content', 'canvas_run'} <= {usage['usage_kind'] for usage in detail['usages']}
        assert (await runtime.client.delete('/files/' + file_id)).status_code == 409
        revision = (await runtime.client.get(runtime.url)).json()['data']['revision']
        rejected = await runtime.client.delete(runtime.url, params={'expected_revision': revision})
        assert rejected.status_code == 409 and rejected.json()['detail']['code'] == 'RUN_SCOPE_BUSY'
        assert (await runtime.client.delete('/projects/' + runtime.project_id)).status_code == 409
        doc['cards'] = [card for card in doc['cards'] if card['id'] != 'known']
        doc['cards'][1]['prompt']['segments'] = [doc['cards'][1]['prompt']['segments'][0]]
        doc['edges'] = [doc['edges'][0]]
        doc['input_order']['B']['image'] = ['image-B']
        await save(runtime, doc)
        release = '/files/' + file_id + '/upload-retention?project_id=' + runtime.project_id
        assert (await runtime.client.delete(release)).status_code == 409
        cancelled = await runtime.client.post(runtime.url + '/runs/' + accepted['run_id'] + '/cancel')
        assert cancelled.status_code == 200, cancelled.text
        assert (await runtime.client.delete(release)).status_code == 409
        revision = (await runtime.client.get(runtime.url)).json()['data']['revision']
        assert (await runtime.client.delete(runtime.url, params={'expected_revision': revision})).status_code == 200
        assert (await runtime.client.delete('/files/' + file_id)).status_code == 409
        assert (await runtime.client.delete(release)).status_code == 200
        assert (await runtime.client.get('/files/' + file_id + '/download')).content == b'known'
        assert (await runtime.client.delete('/files/' + file_id)).status_code == 200
        worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['mysql'], indirect=True)
@pytest.mark.parametrize('operation', ['initial_upload', 'release'])
async def test_canvas_upload_and_retention_http_success_waits_for_real_database_commit(runtime, image_storage, operation):
    """File upload and retention success must describe committed file/usage changes."""
    import socket
    import uvicorn
    from fastapi import Request
    from app.api.v1.routes.studio.files import router
    from app.dependencies import get_db
    runtime.app.include_router(router, prefix='/files')
    uploaded = await runtime.client.post('/files/upload', files={'file': ('commit.png', b'commit', 'image/png')},
        data={'project_id': runtime.project_id, 'usage_kind': 'generation_upload'})
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()['data']['id']
    commit_started, allow_commit = asyncio.Event(), asyncio.Event()
    original = runtime.app.dependency_overrides[get_db]
    async def database(request: Request):
        async with runtime.sessions() as db:
            try:
                yield db
                if request.url.path.endswith(('/upload-retention', '/upload')):
                    commit_started.set()
                    await allow_commit.wait()
                await db.commit()
            except Exception:
                await db.rollback()
                raise
    runtime.app.dependency_overrides[get_db] = database
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(runtime.app, log_level='warning', lifespan='off'))
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    pending = None
    try:
        while not server.started:
            await asyncio.sleep(.01)
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}') as client:
            if operation == 'initial_upload':
                pending = asyncio.create_task(client.post('/files/upload', files={'file': ('initial.png', b'initial', 'image/png')},
                    data={'project_id': runtime.project_id, 'usage_kind': 'generation_upload'}))
            else:
                pending = asyncio.create_task(client.delete('/files/' + file_id + '/upload-retention', params={'project_id': runtime.project_id}))
            await asyncio.wait_for(commit_started.wait(), timeout=5)
            done, _ = await asyncio.wait({pending}, timeout=.1)
            assert not done, 'file/retention success reached the HTTP client before commit'
            allow_commit.set()
            response = await pending
            assert response.status_code == (201 if operation == 'initial_upload' else 200), response.text
            if operation == 'initial_upload':
                file_id = response.json()['data']['id']
                assert [usage['usage_kind'] for usage in (await client.get('/files/' + file_id)).json()['data']['usages']] == ['generation_upload']
                assert (await client.delete('/files/' + file_id + '/upload-retention', params={'project_id': runtime.project_id})).status_code == 200
            assert (await client.get('/files/' + file_id)).json()['data']['usages'] == []
            assert (await client.delete('/files/' + file_id)).status_code == 200
    finally:
        allow_commit.set()
        if pending:
            await asyncio.gather(pending, return_exceptions=True)
        server.should_exit = True
        await serving
        runtime.app.dependency_overrides[get_db] = original
