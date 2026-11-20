"""Actual canvas HTTP → submitter → worker image requests and archived results."""
from tests.canvas_prompt_fixtures import bind_document_prompts
import asyncio
import base64
import json
import httpx
import pytest
from botocore.exceptions import ClientError
from app.core import storage
from app.models.llm import Model
from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.fixture
def image_storage(monkeypatch):
    objects = {}
    async def head(*, key):
        if key not in objects:
            raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'HeadObject')
        content, mime, extra = objects[key]
        return storage.StoredFileInfo(key=key, url='unused', size=len(content), content_type=mime, extra=extra)
    async def upload(*, key, data, content_type, extra_args=None):
        objects[key] = (data.read(), content_type, extra_args)
    async def download(*, key):
        return objects[key][0]
    monkeypatch.setattr(storage, 'get_file_info', head)
    monkeypatch.setattr(storage, 'upload_file', upload)
    monkeypatch.setattr(storage, 'download_file', download)
    return objects


async def image_card(runtime, count=3):
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.category, model.name = 'image', 'image-model'
    runtime.document['cards'][0].update(id='image', type='model.image', config={'count': count, 'target_ratio': '1:1', 'resolution_profile': 'standard'})
    response = await runtime.client.put(runtime.url, json={'request_id': 'image-card', 'expected_revision': 1, 'document': runtime.document})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', [None, 'mysql'], indirect=True)
async def test_image_worker_publishes_all_ordered_results_and_history_content(runtime, image_storage):
    await image_card(runtime)
    accepted, preview = await accept(runtime)
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(value).decode()} for value in (b'first', b'second', b'third')]})
    from app.task_worker import TaskWorker
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1
    assert json.loads(calls[0].content) == {'prompt': 'Frozen prompt', 'model': 'image-model', 'size': '1024x1024', 'n': 3, 'response_format': 'url'}
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] == 'succeeded', node
    assert node['result_set_id'] and node['current_output_updated']
    assert [item['source']['position'] for item in state['current_outputs']['image']] == [0, 1, 2]
    assert [image_storage['generated/' + accepted['task_ids'][0] + '/' + str(i)][0] for i in range(3)] == [b'first', b'second', b'third']
    card = (await runtime.client.get(runtime.url + f"/runs/{accepted['run_id']}/nodes/{node['id']}/outputs/1/content")).json()['data']
    assert card['type'] == 'content.image' and card['file_id'] == node['outputs'][1]['file_id']
    assert card['origin']['position'] == 1 and not card['origin']['incomplete']
    runtime.document['cards'].append(card)
    saved = await runtime.client.put(runtime.url, json={'request_id': 'save-image', 'expected_revision': 2, 'document': runtime.document})
    assert saved.status_code == 200, saved.text


async def accept(runtime, request_id='run'):
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'image'})).json()['data']
    assert preview['can_run'], preview
    result = await runtime.client.post(runtime.url + '/runs', json={'request_id': request_id, 'preview_token': preview['preview_token']})
    assert result.status_code == 200, result.text
    return result.json()['data'], preview


@pytest.mark.asyncio
@pytest.mark.parametrize('sources,expected', [(['three', 'three'], [b'three']), (['three', 'alias', 'three'], [b'three', b'three'])])
async def test_actual_image_subset_uses_identity_order_and_never_replaces_literal_words(runtime, image_storage, sources, expected):
    from app.models.studio_prompts_files_timeline import FileItem
    from app.services.studio.file_usages import upsert_file_usage
    await image_card(runtime, 1)
    async with runtime.sessions.begin() as db:
        for name in ('one', 'two', 'three'):
            key = 'references/' + name
            image_storage[key] = (name.encode(), 'image/png', {})
            db.add(FileItem(id=name, name=name, type='image', storage_key=key, content_type='image/png'))
        await db.flush()
        for name in ('one', 'two', 'three'):
            await upsert_file_usage(db, file_id=name, project_id=runtime.project_id, chapter_id=None, usage_kind='upload')
    for name in ('one', 'two', 'three', 'alias'):
        runtime.document['cards'].append({'id': name, 'type': 'content.image', 'file_id': 'three' if name == 'alias' else name})
    runtime.document['edges'] = [{'id': name, 'source_card': name, 'source_port': 'image', 'target_card': 'image', 'target_port': 'image'} for name in ('one', 'two', 'three', 'alias')]
    runtime.document['input_order'] = {'image': {'image': ['one', 'two', 'three', 'alias']}}
    runtime.document['cards'][0]['prompt']['segments'] = [{'kind': 'text', 'id': 'literal', 'text': '普通图片3 [media:1] '}] + [
        {'kind': 'reference', 'id': str(index), 'source': {'canvas_id': runtime.canvas_id, 'card_id': name, 'port_id': 'image', 'position': 0}} for index, name in enumerate(sources)]
    assert (await runtime.client.put(runtime.url, json={'request_id': 'refs', 'expected_revision': 2, 'document': bind_document_prompts(runtime.document)})).status_code == 200
    _, preview = await accept(runtime)
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
    from app.task_worker import TaskWorker
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1 and calls[0].url.path == '/v1/images/edits'
    body = json.loads(calls[0].content)
    assert [base64.b64decode(item['image_url'].split(',')[1]) for item in body['images']] == expected
    assert body['prompt'] == '普通图片3 [media:1] ' + ''.join('image ' + str(1 if name == 'three' else 2) for name in sources)
    assert preview['input']['text'] == body['prompt']
    assert [item['token'] for item in preview['input']['media']] == (['@图片3'] if len(expected) == 1 else ['@图片3', '@图片4'])


@pytest.mark.asyncio
async def test_image_precheck_reports_actual_reference_capacity_without_truncation(runtime, image_storage):
    from app.core.integrations.image_capabilities import ImageModelCapability, register_image_model_capability, clear_image_model_capability_overrides
    from app.models.studio_prompts_files_timeline import FileItem
    from app.services.studio.file_usages import upsert_file_usage
    await image_card(runtime, 1)
    async with runtime.sessions.begin() as db:
        db.add(FileItem(id='shared-image', name='shared', type='image', storage_key='shared.png', content_type='image/png'))
        await db.flush()
        await upsert_file_usage(db, file_id='shared-image', project_id=runtime.project_id, chapter_id=None, usage_kind='upload')
    runtime.document['cards'] += [{'id': name, 'type': 'content.image', 'file_id': 'shared-image'} for name in ('a', 'b')]
    runtime.document['edges'] = [{'id': name, 'source_card': name, 'source_port': 'image', 'target_card': 'image', 'target_port': 'image'} for name in ('a', 'b')]
    runtime.document['input_order'] = {'image': {'image': ['a', 'b']}}
    runtime.document['cards'][0]['prompt']['segments'] = [{'kind': 'reference', 'id': name, 'source': {'canvas_id': runtime.canvas_id, 'card_id': name, 'port_id': 'image', 'position': 0}} for name in ('a', 'b')]
    assert (await runtime.client.put(runtime.url, json={'request_id': 'capacity', 'expected_revision': 2, 'document': bind_document_prompts(runtime.document)})).status_code == 200
    register_image_model_capability(provider='openai', model_prefix='image-model', capability=ImageModelCapability(max_reference_images=1, supports_duplicate_reference_images=False))
    try:
        preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'image'})).json()['data']
        assert not preview['can_run']
        assert {'REFERENCE_COUNT_EXCEEDED', 'DUPLICATE_MEDIA_UNSUPPORTED'} <= {item['code'] for item in preview['diagnostics']}
        assert len(preview['input']['media']) == 2
        runtime.document['cards'][0]['prompt']['segments'].pop()
        runtime.document['cards'][0]['input_bindings'].pop()
        assert (await runtime.client.put(runtime.url, json={'request_id': 'subset-capacity', 'expected_revision': 3, 'document': bind_document_prompts(runtime.document)})).status_code == 200
        valid = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'image'})).json()['data']
        assert valid['can_run'] and len(valid['input']['media']) == 1
    finally:
        clear_image_model_capability_overrides(provider='openai')


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['app-handler'], indirect=True)
async def test_third_download_failure_retains_two_unfinished_images_and_previous_current(runtime, image_storage):
    await image_card(runtime)
    from app.task_worker import TaskWorker
    calls = []
    failing = False
    def provider(request):
        calls.append(request)
        if request.method == 'POST':
            return httpx.Response(200, json={'data': [{'url': 'https://images.test/' + str(i)} for i in range(3)]})
        if failing and request.url.path == '/2':
            return httpx.Response(503)
        return httpx.Response(200, content=request.url.path.encode(), headers={'content-type': 'image/png'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await accept(runtime)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        before = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        old = before['current_outputs']['image']
        failing = True
        accepted, _ = await accept(runtime, 'partial')
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        await worker.tick()
        worker.text_pool.shutdown(wait=False)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(run['nodes'][0] for run in state['runs'] if run['id'] == accepted['run_id'])
    assert node['status'] == 'failed' and len(node['outputs']) == 2
    assert node['result_set_id'] is None and not node['current_output_updated']
    assert state['current_outputs']['image'] == old
    assert len([call for call in calls if call.method == 'POST']) == 2
    assert len(image_storage) == 5
    for output in node['outputs']:
        usages = await runtime.client.get('/api/v1/studio/files/' + output['file_id'] + '')
        assert usages.status_code == 200, usages.text
        assert 'canvas_history' in usages.text
        deletion = await runtime.client.delete('/api/v1/studio/files/' + output['file_id'])
        assert deletion.status_code == 409, deletion.text
    card_response = await runtime.client.get(runtime.url + f"/runs/{accepted['run_id']}/nodes/{node['id']}/outputs/1/content")
    assert card_response.status_code == 200, card_response.text
    card = card_response.json()['data']
    assert card['origin']['incomplete'] and card['file_id'] == node['outputs'][1]['file_id']
    runtime.document['cards'].append(card)
    assert (await runtime.client.put(runtime.url, json={'request_id': 'save-unfinished', 'expected_revision': 2, 'document': runtime.document})).status_code == 200
    saved = (await runtime.client.get(runtime.url)).json()['data']['document']['cards'][-1]
    assert saved['origin'] == card['origin']
    assert (await runtime.client.get('/api/v1/studio/files/' + card['file_id'] + '')).text.count('canvas_content') == 1


@pytest.mark.asyncio
async def test_remote_image_submission_and_every_poll_use_frozen_route_after_edits(runtime, image_storage, monkeypatch):
    from app.models.llm import Provider
    from app.task_worker import TaskWorker
    await image_card(runtime, 1)
    async with runtime.sessions.begin() as db:
        provider = await db.get(Provider, runtime.provider_id)
        provider.name = 'vidu'
    accepted, preview = await accept(runtime)
    async with runtime.sessions.begin() as db:
        provider = await db.get(Provider, runtime.provider_id)
        provider.api_key, provider.base_url, provider.name = 'changed-secret', 'https://changed.test', 'openai'
        model = await db.get(Model, runtime.model_id)
        model.name, model.params = 'changed-image', {'seed': 44}
    runtime.document['cards'][0]['config']['count'] = 2
    assert (await runtime.client.put(runtime.url, json={'request_id': 'edit-during-run', 'expected_revision': 2, 'document': runtime.document})).status_code == 200
    calls = []
    def provider(request):
        calls.append(request)
        assert request.url.host == 'frozen.test'
        assert request.headers['Authorization'] == 'Token private-secret'
        if request.method == 'POST':
            assert json.loads(request.content)['model'] == 'image-model'
            assert json.loads(request.content)['prompt'] == preview['input']['text']
            return httpx.Response(200, json={'task_id': 'remote-image'})
        if len(calls) == 2:
            return httpx.Response(200, json={'state': 'processing'})
        return httpx.Response(200, json={'state': 'success', 'creations': [{'b64_json': 'eA=='}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        from datetime import timedelta
        from app.services.task_service import utcnow
        later = utcnow() + timedelta(seconds=10)
        monkeypatch.setattr('app.task_worker.utcnow', lambda: later)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert [request.method for request in calls] == ['POST', 'GET', 'GET']
    assert calls[1].url.path == calls[2].url.path == '/v1/ent/v2/tasks/remote-image/creations'
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(run['nodes'][0] for run in state['runs'] if run['id'] == accepted['run_id'])
    assert node['status'] == 'succeeded', node
    assert len(node['outputs']) == 1 and not node['current_output_updated']
    assert state['current_outputs'] == {}
    assert 'private-secret' not in str(state)


@pytest.mark.asyncio
async def test_new_complete_images_replace_whole_set_and_prior_order_remains_in_history(runtime, image_storage):
    from app.task_worker import TaskWorker
    await image_card(runtime)
    calls = []
    def provider(request):
        body = json.loads(request.content)
        calls.append(body)
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(f"run{len(calls)}-{i}".encode()).decode()} for i in range(body['n'])]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        first, _ = await accept(runtime)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        old = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['current_outputs']['image']
        runtime.document['cards'][0]['config']['count'] = 1
        assert (await runtime.client.put(runtime.url, json={'request_id': 'count-one', 'expected_revision': 2, 'document': runtime.document})).status_code == 200
        second, _ = await accept(runtime, 'replace')
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert len(state['current_outputs']['image']) == 1
    assert state['current_outputs']['image'][0]['result_set_id'] != old[0]['result_set_id']
    history = next(run['nodes'][0] for run in state['runs'] if run['id'] == first['run_id'])
    assert [item['file_id'] for item in history['outputs']] == [item['file_id'] for item in old]
    assert len(history['outputs']) == 3
    assert next(run['nodes'][0] for run in state['runs'] if run['id'] == second['run_id'])['current_output_updated']
    assert len(calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('response', [{'data': [{'url': 'https://images.test/0'}]}, {'data': [{'url': 'https://images.test/0'}, {}, {'url': 'https://images.test/2'}]}])
async def test_malformed_image_results_fail_without_partial_formal_publication(runtime, image_storage, response):
    from app.task_worker import TaskWorker
    await image_card(runtime)
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(200, json=response)
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await accept(runtime)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        await worker.tick()
        worker.text_pool.shutdown(wait=False)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] == 'failed' and node['result_set_id'] is None
    assert node['outputs'] == [] and state['current_outputs'] == {}
    assert len(calls) == 1 and image_storage == {}


@pytest.mark.asyncio
async def test_downstream_image_three_request_contains_only_the_third_model_result(runtime, image_storage):
    from app.task_worker import TaskWorker
    await image_card(runtime)
    calls = []
    def provider(request):
        body = json.loads(request.content)
        calls.append(body)
        values = [b'first', b'second', b'third'] if len(calls) == 1 else [b'consumer']
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(value).decode()} for value in values]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await accept(runtime)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        reference = {'canvas_id': runtime.canvas_id, 'card_id': 'image', 'port_id': 'image', 'position': 2}
        runtime.document['cards'].append({'id': 'consumer', 'type': 'model.image', 'model_id': runtime.model_id, 'config': {'count': 1},
            'prompt': {'segments': [{'kind': 'text', 'id': 'literal', 'text': '图片3 [media:1] '}, {'kind': 'reference', 'id': 'third', 'source': reference}, {'kind': 'reference', 'id': 'third-again', 'source': reference}]}})
        runtime.document['edges'] = [{'id': 'models', 'source_card': 'image', 'source_port': 'image', 'target_card': 'consumer', 'target_port': 'image'}]
        runtime.document['input_order'] = {'consumer': {'image': ['models']}}
        assert (await runtime.client.put(runtime.url, json={'request_id': 'downstream', 'expected_revision': 2, 'document': bind_document_prompts(runtime.document)})).status_code == 200
        preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
        assert preview['can_run'] and len(preview['input']['media']) == 1
        assert preview['input']['mapping'][0]['token'] == '@图片3'
        assert preview['input']['mapping'][0]['media_position'] == 1
        assert (await runtime.client.post(runtime.url + '/runs', json={'request_id': 'consumer', 'preview_token': preview['preview_token']})).status_code == 200
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 2
    assert calls[1]['prompt'] == preview['input']['text'] == '图片3 [media:1] image 1image 1'
    assert [base64.b64decode(item['image_url'].split(',')[1]) for item in calls[1]['images']] == [b'third']


@pytest.mark.asyncio
async def test_image_v2_independent_adoption_freezes_text_and_selected_image_order(runtime, image_storage):
    """Only explicitly adopted v2 bindings reach the image provider, in receiver order."""
    from app.models.studio_prompts_files_timeline import FileItem
    from app.services.studio.file_usages import upsert_file_usage
    from app.task_worker import TaskWorker
    await image_card(runtime, 1)
    async with runtime.sessions.begin() as db:
        for name in ('a', 'b', 'unused'):
            image_storage[name] = (name.encode(), 'image/png', {})
            db.add(FileItem(id=name, name=name, type='image', storage_key=name, content_type='image/png'))
        await db.flush()
        for name in ('a', 'b', 'unused'):
            await upsert_file_usage(db, file_id=name, project_id=runtime.project_id, chapter_id=None, usage_kind='upload')
    document = runtime.document
    document['cards'] += [{'id': name, 'type': 'content.image', 'file_id': name} for name in ('a', 'b', 'unused')]
    document['cards'].append({'id': 'text', 'type': 'content.text', 'text': 'Literal 图片3 [media:1]'})
    document['edges'] = [{'id': name, 'source_card': name, 'source_port': 'text' if name == 'text' else 'image',
        'target_card': 'image', 'target_port': 'text' if name == 'text' else 'image'} for name in ('a', 'b', 'unused', 'text')]
    document['input_order'] = {'image': {'image': ['a', 'b', 'unused'], 'text': ['text']}}
    document['cards'][0]['input_bindings'] = [{'id': name, 'input_port': 'text' if name == 'text' else 'image',
        'source': {'canvas_id': runtime.canvas_id, 'card_id': name, 'port_id': 'text' if name == 'text' else 'image', 'position': 0}}
        for name in ('b', 'text', 'a')]
    saved = await runtime.client.put(runtime.url, json={'request_id': 'v2-inputs', 'expected_revision': 2, 'document': document})
    assert saved.status_code == 200, saved.text
    accepted, preview = await accept(runtime)
    assert [item['file_id'] for item in preview['input']['media']] == ['b', 'a']
    assert preview['input']['text'] == 'Frozen prompt\nLiteral 图片3 [media:1]'
    assert [item['source']['card_id'] for item in preview['input']['used']] == ['b', 'text', 'a']
    calls = []
    def provider(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert calls[0]['prompt'] == preview['input']['text']
    assert [base64.b64decode(item['image_url'].split(',')[1]) for item in calls[0]['images']] == [b'b', b'a']
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['runs'][0]['nodes'][0]['status'] == 'succeeded'
    assert state['runs'][0]['id'] == accepted['run_id']


@pytest.mark.asyncio
async def test_image_cancel_reopen_keeps_prior_outputs_and_never_adopts_late_results(runtime, image_storage):
    """Image cancellation remains observable through runtime after leaving the request."""
    from app.task_worker import TaskWorker
    await image_card(runtime, 1)
    started, release = asyncio.Event(), asyncio.Event()
    calls = []
    async def provider(request):
        calls.append(request)
        if len(calls) == 2:
            started.set()
            await release.wait()
        return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await accept(runtime)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        before = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['current_outputs']
        second, _ = await accept(runtime, 'cancel-image')
        await worker.tick()
        try:
            await asyncio.wait_for(started.wait(), 5)
            response = await runtime.client.post(runtime.url + f"/runs/{second['run_id']}/cancel")
            assert response.status_code == 200, response.text
            reopened = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
            node = next(run['nodes'][0] for run in reopened['runs'] if run['id'] == second['run_id'])
            assert node['stage'] == 'cancelling'
            assert reopened['current_outputs'] == before
        finally:
            release.set()
            await asyncio.gather(*worker.jobs.values())
            await worker.tick()
            worker.text_pool.shutdown(wait=False)
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(run['nodes'][0] for run in state['runs'] if run['id'] == second['run_id'])
    assert node['status'] == 'cancelled' and not node['current_output_updated']
    assert state['current_outputs'] == before
    assert len(calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['app-handler'], indirect=True)
async def test_image_current_position_missing_does_not_fallback_and_saved_product_stays_fixed(runtime, image_storage):
    from app.task_worker import TaskWorker
    await image_card(runtime)
    def provider(request):
        count = json.loads(request.content)['n']
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(str(i).encode()).decode()} for i in range(count)]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        first, _ = await accept(runtime)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        original = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['runs'][0]['nodes'][0]
        copy = (await runtime.client.get(runtime.url + f"/runs/{first['run_id']}/nodes/{original['id']}/outputs/2/content")).json()['data']
        document = runtime.document
        document['cards'] += [copy, {'id': 'consumer', 'type': 'model.image', 'model_id': runtime.model_id,
            'input_bindings': [{'id': 'third', 'input_port': 'image', 'source': {'canvas_id': runtime.canvas_id, 'card_id': 'image', 'port_id': 'image', 'position': 2}}]}]
        document['edges'] = [{'id': 'candidate', 'source_card': 'image', 'source_port': 'image', 'target_card': 'consumer', 'target_port': 'image'}]
        document['input_order'] = {'consumer': {'image': ['candidate']}}
        document['cards'][0]['config']['count'] = 1
        assert (await runtime.client.put(runtime.url, json={'request_id': 'save-fixed-and-consumer', 'expected_revision': 2, 'document': document})).status_code == 200
        await accept(runtime, 'shorter-result')
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    compiled = (await runtime.client.get(runtime.url + '/cards/consumer/compile')).json()['data']
    assert not compiled['can_run'] and not compiled['media']
    assert any(issue['code'] == 'OUTPUT_MISSING' and issue['target']['path'] == ['input_bindings', 'third'] for issue in compiled['diagnostics'])
    reopened = (await runtime.client.get(runtime.url)).json()['data']['document']
    selected = next(card for card in reopened['cards'] if card['id'] == 'consumer')
    assert selected['input_bindings'][0]['source']['position'] == 2
    fixed = (await runtime.client.get(runtime.url + '/cards/' + copy['id'] + '/outputs')).json()['data']['outputs'][0]
    assert fixed['file_id'] == original['outputs'][2]['file_id']
    assert (await runtime.client.delete('/api/v1/studio/files/' + fixed['file_id'])).status_code == 409


@pytest.mark.asyncio
async def test_withdrawn_published_file_keeps_output_identity_and_result_pointer(runtime, image_storage):
    await image_card(runtime, count=1)
    await accept(runtime)
    from app.task_worker import TaskWorker
    from app.models.studio import FileItem
    from app.services.task_service import utcnow
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200,
            json={'data': [{'b64_json': base64.b64encode(b'image').decode()}]}))) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    before = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['current_outputs']['image'][0]
    async with runtime.sessions.begin() as db:
        file = await db.get(FileItem, before['file_id'])
        file.delete_requested_at = utcnow()
    after = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['current_outputs']['image'][0]
    assert not after['available'] and after['file_id'] is None
    assert (after['source'], after['result_set_id'], after['basis_current']) == (before['source'], before['result_set_id'], before['basis_current'])
