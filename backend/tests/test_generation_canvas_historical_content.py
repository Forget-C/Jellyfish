"""Historical content preparation and provenance through public HTTP commands."""
from copy import deepcopy
import pytest
from tests.test_generation_canvas_runs import runtime, accept  # noqa: F401


async def finished_history(runtime):
    from app.services.task_service import TaskService
    accepted, _ = await accept(runtime)
    async with runtime.sessions.begin() as db:
        service = TaskService(db)
        await service.claim(accepted['task_ids'][0], worker_id='history')
        await service.finish(accepted['task_ids'][0], result={'text': 'Fixed historical text'})
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    return accepted['run_id'], node


def content_url(runtime, run, node, position=0):
    return runtime.url + f'/runs/{run}/nodes/{node}/outputs/{position}/content'


@pytest.mark.asyncio
@pytest.mark.parametrize('case', ['project', 'canvas', 'run', 'node', 'negative', 'range', 'active'])
async def test_history_content_rejects_wrong_scope_or_unavailable_output(runtime, case):
    run, node = await finished_history(runtime)
    node_id, position = node['id'], 0
    if case == 'active':
        from app.models.generation_canvas import CanvasRunNode
        async with runtime.sessions.begin() as db:
            stored = await db.get(CanvasRunNode, node_id)
            stored.status = 'running'
    if case == 'run':
        run = 'wrong'
    if case == 'node':
        node_id = 'wrong'
    if case in ('negative', 'range'):
        position = -1 if case == 'negative' else 1
    url = content_url(runtime, run, node_id, position)
    if case == 'project':
        url = url.replace(runtime.project_id, 'wrong-project')
    if case == 'canvas':
        url = url.replace(runtime.canvas_id, 'wrong-canvas')
    response = await runtime.client.get(url)
    if case in ('project', 'canvas'):
        assert response.status_code == 404
        assert response.json()['detail'] == 'Canvas not found'
    else:
        assert response.status_code == 422
        assert response.json()['detail'] == {'code': 'OUTPUT_NOT_AVAILABLE', 'severity': 'error',
            'message': '历史成果不存在或尚未完成', 'target': {'node_id': node_id, 'position': position}, 'blocks': ['save']}


@pytest.mark.asyncio
async def test_preparation_is_independent_and_saved_origin_cannot_be_removed(runtime):
    run, node = await finished_history(runtime)
    before = (await runtime.client.get(runtime.url)).json()['data']
    first = (await runtime.client.get(content_url(runtime, run, node['id']))).json()['data']
    second = (await runtime.client.get(content_url(runtime, run, node['id']))).json()['data']
    assert first['id'] != second['id']
    assert first['origin'] == second['origin']
    assert (await runtime.client.get(runtime.url)).json()['data'] == before
    document = deepcopy(runtime.document)
    document['cards'].append(first)
    assert (await runtime.client.put(runtime.url, json={'request_id': 'copy', 'expected_revision': 1, 'document': document})).status_code == 200
    document['cards'][-1]['text'] = 'Independent edit'
    document['cards'] = document['cards'][1:]  # Original model is no longer required.
    assert (await runtime.client.put(runtime.url, json={'request_id': 'edit', 'expected_revision': 2, 'document': document})).status_code == 200
    assert (await runtime.client.get(content_url(runtime, run, node['id']))).json()['data']['text'] == 'Fixed historical text'
    document['cards'][-1].pop('origin')
    response = await runtime.client.put(runtime.url, json={'request_id': 'remove-origin', 'expected_revision': 3, 'document': document})
    assert response.json()['detail']['code'] == 'IMMUTABLE_ORIGIN'
    assert (await runtime.client.get(runtime.url)).json()['data']['revision'] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize('case,code', [('canvas', 'INVALID_ORIGIN'), ('node', 'OUTPUT_NOT_AVAILABLE'),
    ('body', 'INVALID_ORIGIN'), ('incomplete', 'INVALID_ORIGIN')])
async def test_first_origin_rejection_precedes_other_save_errors(runtime, case, code):
    run, node = await finished_history(runtime)
    card = (await runtime.client.get(content_url(runtime, run, node['id']))).json()['data']
    if case in ('canvas', 'node'):
        card['origin'][case + '_id'] = 'wrong'
    elif case == 'body':
        card['text'] = 'Forged'
    else:
        card['origin']['incomplete'] = True
    doc = deepcopy(runtime.document)
    doc['cards'].append(card)
    doc['edges'] = [{'id': 'bad-edge', 'source_card': 'missing', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'}]
    response = await runtime.client.put(runtime.url, json={'request_id': 'rejected', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == code
    assert (await runtime.client.get(runtime.url)).json()['data']['revision'] == 1


@pytest.mark.asyncio
async def test_media_withdrawal_after_preparation_preserves_save_state(runtime):
    from app.models.generation_canvas import CanvasRunNode
    from app.models.studio_prompts_files_timeline import FileItem
    from app.services.studio.file_usages import upsert_file_usage
    from app.services.task_service import utcnow
    run, node = await finished_history(runtime)
    # Seed an archived media fact; preparation and saving use the real HTTP paths.
    async with runtime.sessions.begin() as db:
        db.add(FileItem(id='history-file', name='history', type='image', storage_key='history', content_type='image/png'))
        stored = await db.get(CanvasRunNode, node['id'])
        stored.outputs = [{'modality': 'image', 'file_id': 'history-file'}]
        await db.flush()
        await upsert_file_usage(db, file_id='history-file', project_id=runtime.project_id,
            chapter_id=None, usage_kind='canvas_history', source_ref=f'{runtime.canvas_id}:{node["id"]}:0')
    card = (await runtime.client.get(content_url(runtime, run, node['id']))).json()['data']
    before = (await runtime.client.get(runtime.url)).json()['data']
    async with runtime.sessions.begin() as db:
        file = await db.get(FileItem, 'history-file')
        file.delete_requested_at = utcnow()
    response = await runtime.client.get(content_url(runtime, run, node['id']))
    assert response.status_code == 410 and response.json()['detail'] == 'File deleted'
    doc = deepcopy(runtime.document)
    doc['cards'].append(card)
    command = {'request_id': 'withdrawn', 'expected_revision': 1, 'document': doc}
    response = await runtime.client.put(runtime.url, json=command)
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'INVALID_MEDIA_FILE'
    assert (await runtime.client.get(runtime.url)).json()['data'] == before
    # Reusing the rejected request proves it left no successful receipt behind.
    doc['cards'].pop()
    assert (await runtime.client.put(runtime.url, json=command)).status_code == 200


@pytest.mark.asyncio
async def test_existing_plain_content_cannot_acquire_historical_origin(runtime):
    run, node = await finished_history(runtime)
    card = (await runtime.client.get(content_url(runtime, run, node['id']))).json()['data']
    origin = card.pop('origin')
    doc = deepcopy(runtime.document)
    doc['cards'].append(card)
    assert (await runtime.client.put(runtime.url, json={'request_id': 'plain', 'expected_revision': 1, 'document': doc})).status_code == 200
    card['origin'] = origin
    response = await runtime.client.put(runtime.url, json={'request_id': 'attach-origin', 'expected_revision': 2, 'document': doc})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'IMMUTABLE_ORIGIN'


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['failed', 'cancelled', 'blocked'])
async def test_terminal_partial_content_does_not_require_result_set(runtime, status):
    from app.models.generation_canvas import CanvasRunNode
    run, node = await finished_history(runtime)
    async with runtime.sessions.begin() as db:
        stored = await db.get(CanvasRunNode, node['id'])
        stored.status, stored.result_set_id = status, None
    response = await runtime.client.get(content_url(runtime, run, node['id']))
    assert response.status_code == 200
    card = response.json()['data']
    assert card['text'] == 'Fixed historical text' and card['origin']['incomplete']
