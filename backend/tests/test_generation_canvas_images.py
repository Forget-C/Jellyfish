"""Actual canvas HTTP → submitter → worker image requests and archived results."""
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
