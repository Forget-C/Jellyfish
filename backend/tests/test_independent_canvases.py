"""独立画布公共接口的归属、能力及生命周期。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', [None, 'mysql'], indirect=True)
async def test_create_independent_canvas_and_list_summary(canvas_client):
    created = await canvas_client.post('/canvases', json={'name': '自由创作'})
    assert created.status_code == 200, created.text
    canvas = created.json()['data']
    assert canvas['project_id'] is None
    listing = await canvas_client.get('/canvases', params={'q': '自由', 'page': 1, 'page_size': 1})
    assert listing.status_code == 200
    data = listing.json()['data']
    assert data['pagination']['total'] == 1
    assert data['items'][0]['id'] == canvas['id']
    assert data['items'][0]['cover_file_id'] is None
    assert 'document' not in data['items'][0]
    assert (await canvas_client.get('/canvases', params={'q': '不存在'})).json()['data']['items'] == []


@pytest.mark.asyncio
async def test_independent_canvas_catalog_and_save_reject_storyboard_cards(canvas_client):
    canvas = (await canvas_client.post('/canvases', json={})).json()['data']
    url = '/canvases/' + canvas['id']
    catalog = (await canvas_client.get(url + '/catalog')).json()['data']
    types = {card['type'] for card in catalog['cards']}
    assert {'content.basis', 'content.character', 'reference.character', 'model.image'} <= types
    assert not any(kind.startswith(('direction.', 'review.')) for kind in types)
    document = {**canvas['document'], 'cards': [{'id': 'style', 'type': 'direction.style'}]}
    rejected = await canvas_client.put(url, json={'request_id': 'invalid', 'expected_revision': 0, 'document': document})
    assert rejected.status_code == 422
    assert rejected.json()['detail']['code'] == 'CARD_TYPE_NOT_ALLOWED'
    assert rejected.json()['detail']['target']['card_id'] == 'style'
    assert (await canvas_client.get(url)).json()['data']['revision'] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', [None, 'mysql'], indirect=True)
async def test_independent_media_survives_canvas_deletion(canvas_client):
    canvas = (await canvas_client.post('/canvases', json={})).json()['data']
    uploaded = await canvas_client.post('/files/upload', files={'file': ('image.png', b'png', 'image/png')})
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()['data']['id']
    url = '/canvases/' + canvas['id']
    document = {**canvas['document'], 'cards': [{'id': 'image', 'type': 'content.image', 'file_id': file_id}]}
    saved = await canvas_client.put(url, json={'request_id': 'image', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    detail = await canvas_client.get('/files/' + file_id)
    assert detail.status_code == 200, detail.text
    assert detail.json()['data']['usages'][0]['project_id'] is None
    assert (await canvas_client.delete('/files/' + file_id)).status_code == 409
    assert (await canvas_client.delete(url, params={'expected_revision': 1})).status_code == 200
    assert (await canvas_client.get('/files/' + file_id + '/download')).status_code == 200
    assert (await canvas_client.delete('/files/' + file_id)).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('name', ['', '   ', 'x' * 256])
async def test_independent_canvas_rejects_invalid_name(canvas_client, name):
    assert (await canvas_client.post('/canvases', json={'name': name})).status_code == 422


@pytest.mark.asyncio
async def test_rename_is_revision_checked_and_project_scope_cannot_open_free_canvas(canvas_client):
    canvas = (await canvas_client.post('/canvases', json={})).json()['data']
    url = '/canvases/' + canvas['id']
    assert (await canvas_client.get(url, params={'project_id': 'p'})).status_code == 404
    for body in ({'expected_revision': 0}, {'name': '   ', 'expected_revision': 0}):
        assert (await canvas_client.patch(url + '/name', json=body)).status_code == 422
    renamed = await canvas_client.patch(url + '/name', json={'name': '重命名', 'expected_revision': 0})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()['data']['document']['name'] == '重命名'
    stale = await canvas_client.patch(url + '/name', json={'name': '旧修改', 'expected_revision': 0})
    assert stale.status_code == 409
    assert (await canvas_client.get(url)).json()['data']['document']['name'] == '重命名'
    # Removed project-scoped creation is not retained as a compatibility route.
    assert (await canvas_client.post('/canvases/p', json={})).status_code == 405


@pytest.mark.asyncio
async def test_scene_canvas_is_not_listed_or_readable_as_free(canvas_client):
    from tests.canvas_urls import seed_scene_canvas, canvas_url
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '场次方案'})).json()['data']
    assert (await canvas_client.get('/canvases/' + canvas['id'])).status_code == 404
    assert (await canvas_client.get('/canvases')).json()['data']['pagination']['total'] == 0
    catalog = (await canvas_client.get(canvas_url('/canvases/p/' + canvas['id'] + '/catalog'))).json()['data']
    assert any(card['type'] == 'direction.style' for card in catalog['cards'])


from tests.test_generation_canvas_runs import runtime, accept


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['independent'], indirect=True)
async def test_independent_text_generation_survives_reopen_and_retains_history(runtime):
    import asyncio
    import json
    import httpx
    from app.task_worker import TaskWorker
    await accept(runtime)
    active_delete = await runtime.client.delete(runtime.url, params={'expected_revision': 1})
    assert active_delete.status_code == 409
    def reply(_request):
        chunk = {'choices': [{'index': 0, 'delta': {'content': '独立结果'}, 'finish_reason': None}]}
        return httpx.Response(200, text=f'data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n',
                              headers={'Content-Type': 'text/event-stream'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as transport:
        worker = TaskWorker(runtime.sessions, client=transport)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
    reopened = await runtime.client.get(runtime.url)
    assert reopened.json()['data']['project_id'] is None
    snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert snapshot['runs'][0]['nodes'][0]['status'] == 'succeeded'
    assert snapshot['runs'][0]['nodes'][0]['text'] == '独立结果'


from tests.test_generation_canvas_images import image_storage, image_card, accept as accept_image


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['independent'], indirect=True)
async def test_independent_image_result_is_managed_file_and_task_history_survives_deletion(runtime, image_storage):
    import asyncio
    import base64
    import httpx
    from app.api.v1.routes.studio.files import router as files_router
    from app.api.v1.routes.film.task_status import router as tasks_router
    from app.task_worker import TaskWorker
    runtime.app.include_router(files_router, prefix='/files')
    runtime.app.include_router(tasks_router)
    await image_card(runtime, count=1)
    await accept_image(runtime)
    def reply(_request):
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'generated-image').decode()}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as transport:
        worker = TaskWorker(runtime.sessions, client=transport)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
    snapshot = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = snapshot['runs'][0]['nodes'][0]
    assert node['status'] == 'succeeded'
    file_id = node['outputs'][0]['file_id']
    files = (await runtime.client.get('/files')).json()['data']['items']
    assert any(file['id'] == file_id for file in files)
    detail = await runtime.client.get('/files/' + file_id)
    assert detail.status_code == 200, detail.text
    assert all(usage['project_id'] is None for usage in detail.json()['data']['usages'])
    assert (await runtime.client.delete('/files/' + file_id)).status_code == 409
    tasks = (await runtime.client.get('/tasks')).json()['data']['items']
    assert tasks[0]['source']['canvas_id'] == runtime.canvas_id
    assert tasks[0]['source']['project_id'] is None
    assert (await runtime.client.delete(runtime.url, params={'expected_revision': 2})).status_code == 200
    history = (await runtime.client.get('/tasks')).json()['data']['items']
    assert history[0]['source']['kind'] == 'deleted_canvas'
    assert (await runtime.client.get('/files/' + file_id + '/download')).content == b'generated-image'
    assert (await runtime.client.delete('/files/' + file_id)).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', [None, 'mysql'], indirect=True)
async def test_free_canvas_reuses_project_file_and_survives_project_deletion(canvas_client):
    file = await canvas_client.post('/files/upload', files={'file': ('project.png', b'project-image', 'image/png')},
                                    data={'project_id': 'p', 'usage_kind': 'generation_upload'})
    file_id = file.json()['data']['id']
    canvas = (await canvas_client.post('/canvases', json={})).json()['data']
    url = '/canvases/' + canvas['id']
    document = {**canvas['document'], 'cards': [{'id': 'shared', 'type': 'content.image', 'file_id': file_id}]}
    assert (await canvas_client.put(url, json={'request_id': 'shared', 'expected_revision': 0, 'document': document})).status_code == 200
    before = (await canvas_client.get(url)).json()['data']['document']
    file_before = (await canvas_client.get('/files/' + file_id + '/download')).content
    assert (await canvas_client.delete('/projects/p')).status_code == 200
    assert (await canvas_client.get(url)).json()['data']['document'] == before
    assert (await canvas_client.get('/files/' + file_id + '/download')).content == file_before
    assert (await canvas_client.delete('/files/' + file_id)).status_code == 409
