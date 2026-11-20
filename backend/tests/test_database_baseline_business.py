"""Exercise current business APIs and the Worker after formal MySQL initialization."""

import asyncio
import base64
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.main import app
from app.task_worker import TaskWorker
from tests.directing.samples import design_sample, plan_sample
from tests.services.test_task_mysql import isolated_database_url
from tests.test_generation_canvas_images import image_storage  # noqa: F401


STUDIO = '/api/v1/studio'
FILM = '/api/v1/film'
LLM = '/api/v1/llm'
STORY = '哥哥提出借钱，弟弟回避。两人回到屋里。'
IMAGE = b'generated image'
VIDEO = b'generated video'


@pytest_asyncio.fixture(params=['sqlite', 'mysql'])
async def baseline_client(request, tmp_path, monkeypatch):
    if request.param == 'mysql':
        engine = create_async_engine(isolated_database_url(), isolation_level='READ COMMITTED')
    else:
        engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/business.db')
        async with engine.begin() as db:
            await db.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    monkeypatch.setattr('app.dependencies.async_session_maker', sessions)
    try:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                yield client, sessions
    finally:
        await engine.dispose()


async def data(response, status=200):
    """Keep HTTP failures legible at the action that caused them."""
    result = await response
    assert result.status_code == status, result.text
    return result.json()['data']


async def save_division(client, path, draft, request_id, *, identity_changes_confirmed=False):
    preview = await data(client.post(path + '/division/preview', json=draft))
    body = {'request_id': request_id, 'draft': draft, 'preview_token': preview['preview_token'],
            'identity_changes_confirmed': identity_changes_confirmed}
    saved = await data(client.put(path + '/division', json=body))
    assert await data(client.put(path + '/division', json=body)) == saved
    return saved['chapter']


async def restore_division(client, path):
    """Create a division, exit one scene, then recover the original identities."""
    chapter = await data(client.get(path))
    head = {'source_version': chapter['source_version'], 'baseline': [], 'lineage': [], 'exited_sequence_ids': []}
    split = STORY.index('。') + 1
    original = await save_division(client, path, {**head, 'members': [
        {'key': 'first', 'title': '桌边', 'span': {'start': 0, 'end': split}},
        {'key': 'second', 'title': '屋内', 'span': {'start': split, 'end': len(STORY)}},
    ]}, 'initial')
    first, second = original['sequences']
    version_id = original['current_version']['id']
    edited = await save_division(client, path, {**head,
        'baseline': [{'sequence_id': row['id'], 'version': row['version']} for row in (first, second)],
        'members': [{'key': 'first', 'sequence_id': first['id'], 'title': first['title'], 'span': first['span']}],
        'lineage': [{'sequence_id': first['id'], 'target_keys': ['first']},
                    {'sequence_id': second['id'], 'target_keys': []}],
        'exited_sequence_ids': [second['id']],
    }, 'exit', identity_changes_confirmed=True)
    historical = await data(client.get(path + '/division/versions/' + version_id))
    restored = await save_division(client, path, {**head,
        'source_revision_id': version_id,
        'baseline': [{'sequence_id': row['id'], 'version': row['version']} for row in edited['sequences']],
        'restored_baseline': historical['restored_baseline'],
        'members': [{'key': row['id'], 'sequence_id': row['id'], 'title': row['title'], 'span': row['span']}
                    for row in historical['chapter']['sequences']],
        'lineage': [{'sequence_id': first['id'], 'target_keys': [first['id']]}],
    }, 'restore', identity_changes_confirmed=True)
    assert [(row['id'], row['position']) for row in restored['sequences']] == [(first['id'], 0), (second['id'], 1)]
    assert (await data(client.get(path + '/division/history')))['total'] == 3
    return first['id']


async def finish_task(client, worker, task_id):
    """Drive normal Worker claiming/polling and observe the status API."""
    for _ in range(16):
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        result = await data(client.get(f'{FILM}/tasks/{task_id}/result'))
        assert result['status'] not in {'failed', 'cancelled'}, result
        if result['status'] == 'succeeded':
            return result
        await asyncio.sleep(.15)
    pytest.fail(f'Task did not finish: {result}')


def provider_response(request):
    if request.url.host == 'image.test':
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(IMAGE).decode()}]})
    if request.url.host == 'video.test':
        if request.method == 'POST':
            submitted = json.loads(request.content)
            assert submitted['ratio'] == '16:9'
            first_frame = next(item for item in submitted['content'] if item.get('role') == 'first_frame')
            assert first_frame['image_url']['url'] == 'data:image/png;base64,' + base64.b64encode(IMAGE).decode()
            return httpx.Response(200, json={'id': 'baseline-video'})
        return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://media.test/take.mp4'}})
    assert request.url.host == 'media.test', request.url
    return httpx.Response(200, content=VIDEO, headers={'Content-Type': 'video/mp4'})


class DirectingModel:
    """Respond at the external model contract using the submitted review packet."""

    def __init__(self, **_kwargs):
        pass

    def invoke(self, messages):
        context = json.loads(messages[1].content)
        if 'packet' in context:
            result = context['packet']
            for row in result['rows']:
                row.update(verdict='pass', rationale='镜头动作和因果清晰')
        else:
            result = design_sample()
        return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))


async def publish_character(client, project_id, suffix, source_file_id):
    """Import an independent project role and publish its main image."""
    actors = STUDIO + '/entities/actor'
    characters = STUDIO + '/entities/character'
    actor_id, character_id = 'actor-' + suffix, 'role-' + suffix
    await data(client.post(actors, json={'id': actor_id, 'name': f'弟弟 {suffix[:8]}'}), 201)
    await data(client.post(f'{actors}/{actor_id}/images', json={'file_id': source_file_id, 'view_angle': 'FRONT'}), 201)
    role = await data(client.post(characters + '/image-source', json={
        'id': character_id, 'name': '项目角色', 'source_id': actor_id, 'project_id': project_id,
    }), 201)
    assert role['origin'] == 'library' and role['created_at']
    assert role['visual_style'] is None and role['style'] is None
    role_images = await data(client.get(f'{characters}/{character_id}/images'))
    primary = role_images['items'][0]
    assert primary['is_primary'] and primary['file_id'] != source_file_id
    published = await data(client.post(f'{characters}/{character_id}/publish-to-library', json={'name': f'入库角色 {suffix[:8]}'}), 201)
    assert published['origin'] == 'project' and published['created_at']
    assert (published['source_kind'], published['source_id']) == ('character', role['id'])
    images = await data(client.get(f"{actors}/{published['id']}/images"))
    assert images['items'][0]['is_primary']
    assert images['items'][0]['file_id'] not in {primary['file_id'], source_file_id}
    return primary['file_id']


async def check_production(client, worker, path, text_id, video_id, reference_file_id):
    """Adopt a model design and review, submit a batch, then cut the resulting Take."""
    design_job = await data(client.post(path + '/design', json={'model_id': text_id}))
    await finish_task(client, worker, design_job['task_id'])
    adopted = await data(client.post(path + '/design/apply', json=design_job))
    design = adopted['designs'][0]
    assert design['content']['direction']['viewpoint']['text'] == '弟弟的反应'
    await data(client.post(f"{path}/revisions/{design['id']}/confirm", json={'expected_version': design['version']}))

    sample = plan_sample(design['id'])
    unit = sample['units'][0]
    unit['coverage'] = unit['coverage'][:1]
    unit.update(model_id=video_id, duration_ms=5_000, references=[{
        'id': 'first-frame', 'file_id': reference_file_id, 'purpose': 'composition', 'media_kind': 'image',
        'participant_ids': [], 'ordinal': 0, 'input_role': 'first_frame',
        'source': {'kind': 'human', 'reference': 'author', 'version': '1'},
    }])
    sample['units'] = [unit]
    planned = await data(client.post(path + '/revisions', json={'document': {'kind': 'plan', 'content': sample}}))
    plan = planned['plans'][0]
    await data(client.post(f"{path}/revisions/{plan['id']}/confirm", json={'expected_version': plan['version']}))
    compiled = await data(client.post(path + '/compile', json={
        'plan_revision_id': plan['id'], 'unit_id': unit['id'], 'request_id': f"compile-{plan['id']}",
    }))
    prompt_id = compiled['compiled_prompt_revision_id']
    review_job = await data(client.post(f'{path}/prompts/{prompt_id}/review', json={'model_id': text_id}))
    await finish_task(client, worker, review_job['task_id'])
    reviewed = await data(client.post(path + '/review/apply', json=review_job))
    review = reviewed['reviews'][0]
    assert review['confirmed_at'] and all(row['verdict'] == 'pass' for row in review['content']['rows'])

    batch = await data(client.post(path + '/batches/prepare', json={'items': [
        {'prompt_revision_id': prompt_id, 'review_revision_id': review['id']},
    ]}))
    assert batch['items'][0]['status'] == 'ready', batch
    submit = f"{path}/batches/{batch['id']}/submit"
    submit_body = {'expected_version': batch['version']}
    accepted = await data(client.post(submit, json=submit_body))
    task_id = accepted['items'][0]['task_id']
    assert (await data(client.post(submit, json=submit_body)))['items'][0]['task_id'] == task_id
    result = await finish_task(client, worker, task_id)
    assert (await data(client.get(path + '/batches')))[0]['items'][0]['status'] == 'succeeded'
    workspace = await data(client.get(path))
    take = next(row for row in workspace['takes'] if row['task_id'] == task_id)
    media = await data(client.get(f"{path}/takes/{take['id']}/media"))
    assert media['file_id'] == result['outputs'][0]['file_id']
    assert (await client.get(media['url'])).content == VIDEO
    assert (await client.delete(f"{STUDIO}/files/{media['file_id']}")).status_code == 409

    cut = await data(client.post(path + '/revisions', json={'document': {'kind': 'cut', 'content': {'items': [{
        'kind': 'media', 'id': 'clip', 'take_id': take['id'], 'timeline_start_ms': 0,
        'media_range': {'source_in_ms': 0, 'source_out_ms': 1000},
    }]}}}))
    cut_id = cut['cuts'][0]['id']
    await data(client.post(f'{path}/revisions/{cut_id}/confirm', json={'expected_version': cut['cuts'][0]['version']}))
    current = await data(client.get(path))
    assert current['cuts'][0]['confirmed_at']
    assert current['cuts'][0]['content']['items'][0]['take_id'] == take['id']
    assert (await client.get(path + '/versions')).status_code == 404
    assert (await client.get(path + '/deliveries')).status_code == 404


@pytest.mark.asyncio
async def test_new_project_reads_current_canvas_assets_and_production(baseline_client, image_storage, monkeypatch):
    client, sessions = baseline_client
    suffix = uuid4().hex
    project_id, chapter_id = 'project-' + suffix, 'chapter-' + suffix
    text_id, image_id, video_id = ('text-' + suffix, 'image-' + suffix, 'video-' + suffix)
    for provider_id, name, host in ((image_id, 'openai', 'image.test'), (video_id, 'volcengine', 'video.test')):
        await data(client.post(LLM + '/providers', json={
            'id': provider_id, 'name': name, 'base_url': f'https://{host}/v1', 'api_key': 'stub', 'status': 'active',
        }), 201)
    for model_id, name, category, provider_id in (
        (text_id, 'baseline-text', 'text', image_id),
        (image_id, 'baseline-image', 'image', image_id),
        (video_id, 'doubao-seedance', 'video', video_id),
    ):
        await data(client.post(LLM + '/models', json={
            'id': model_id, 'name': name, 'category': category, 'provider_id': provider_id,
        }), 201)
    monkeypatch.setattr('app.task_worker.ChatOpenAI', DirectingModel)
    await data(client.post(STUDIO + '/projects', json={
        'id': project_id, 'name': '新库验收', 'style': '真人都市', 'default_video_ratio': '9:16',
    }), 201)
    assert (await data(client.get(f'{STUDIO}/projects/{project_id}')))['default_video_ratio'] == '9:16'
    await data(client.post(STUDIO + '/chapters', json={
        'id': chapter_id, 'project_id': project_id, 'index': 1, 'title': '第一章', 'raw_text': STORY,
    }), 201)
    directing = f'{STUDIO}/projects/{project_id}/directing'
    chapter = f'{directing}/chapters/{chapter_id}'
    sequence_id = await restore_division(client, chapter)
    canvas = await data(client.post(f'{chapter}/sequences/{sequence_id}/canvases', json={'name': '单卡摄影参考'}))
    canvas_path = f"{STUDIO}/generation-canvases/{canvas['id']}"
    scope = {'project_id': project_id}
    document = canvas['document']
    document['cards'].append({'id': 'photo', 'type': 'model.image', 'model_id': image_id,
                         'config': {'count': 1, 'target_ratio': '1:1', 'resolution_profile': 'standard'},
                         'prompt': {'segments': [{'id': 'text', 'kind': 'text', 'text': '桌旁的弟弟'}]}})
    save = {'request_id': 'save-photo', 'expected_revision': canvas['revision'], 'document': document}
    stored = await data(client.put(canvas_path, params=scope, json=save))
    assert await data(client.put(canvas_path, params=scope, json=save)) == stored
    assert (await client.put(canvas_path, params=scope, json={**save, 'request_id': 'stale'})).status_code == 409
    reopened = await data(client.get(canvas_path, params=scope))
    assert reopened['revision'] == stored['revision']
    assert reopened['document']['cards'][-1]['prompt']['segments'] == document['cards'][-1]['prompt']['segments']
    preview = await data(client.post(canvas_path + '/precheck', params=scope, json={'card_id': 'photo'}))
    assert preview['can_run'], preview
    run_request = {'request_id': 'run-photo', 'preview_token': preview['preview_token']}
    submission = await data(client.post(canvas_path + '/runs', params=scope, json=run_request))
    assert await data(client.post(canvas_path + '/runs', params=scope, json=run_request)) == submission
    conflict = await client.post(canvas_path + '/runs', params=scope, json={**run_request, 'preview_token': 'changed'})
    assert conflict.status_code == 409, conflict.text

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider_response)) as external:
        worker = TaskWorker(sessions, client=external)
        try:
            result = await finish_task(client, worker, submission['task_ids'][0])
            file_id = result['outputs'][0]['file_id']
            runtime = await data(client.get(canvas_path + '/runtime', params=scope))
            assert runtime['current_outputs']['photo'][0]['file_id'] == file_id
            file_path = f'{STUDIO}/files/{file_id}'
            assert (await client.get(file_path + '/download')).content == IMAGE
            assert (await client.delete(file_path)).status_code == 409
            reference = await publish_character(client, project_id, suffix, file_id)
            assert (await client.get(f'{STUDIO}/files/{reference}/download')).content == IMAGE
            monkeypatch.setattr('app.services.directing.media.probe_duration', lambda _: 5000)
            await check_production(client, worker, f'{directing}/sequences/{sequence_id}', text_id, video_id, reference)
        finally:
            worker.text_pool.shutdown(wait=True)


@pytest.mark.asyncio
async def test_saved_asset_reference_delete_race(baseline_client, image_storage):
    client, sessions = baseline_client
    project = uuid4().hex
    await data(client.post(STUDIO + '/projects', json={'id': project, 'name': '参考保护', 'style': '真人都市'}), 201)
    for order in ('save', 'delete', 'race'):
        owner = uuid4().hex
        path = STUDIO + '/entities/scene/' + owner
        await data(client.post(STUDIO + '/entities/scene', json={'id': owner, 'name': owner, 'project_id': project}), 201)
        image = await data(client.post(STUDIO + '/files/upload', files={'file': ('ref.png', b'image', 'image/png')},
            data={'project_id': project, 'usage_kind': 'generation_upload'}), 201)
        url = STUDIO + '/files/' + image['id']
        release = url + '/upload-retention'
        async def save():
            return await client.patch(path, json={'references': [{'role': 'design', 'file_id': image['id']}]})
        if order == 'save':
            assert (await save()).status_code == 200
            denial = await client.delete(release, params={'project_id': project})
            assert denial.status_code == 409 and owner in denial.json()['message'] and '参考保护' in denial.json()['message']
            assert (await client.delete(url)).status_code == 409
            assert (await client.patch(path, json={'references': []})).status_code == 200
        await data(client.delete(release, params={'project_id': project}))
        if order == 'race':
            if sessions.kw['bind'].dialect.name != 'mysql':
                continue
            put, remove = await asyncio.gather(save(), client.delete(url))
            assert (put.status_code, remove.status_code) in {(200, 409), (410, 200)}
        else:
            await data(client.delete(url))
            assert (await save()).status_code == 410
