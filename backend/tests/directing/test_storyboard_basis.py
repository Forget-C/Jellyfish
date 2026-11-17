"""分镜创建通过公开接口核对原文、准备和原请求身份。"""

from tests.canvas_urls import canvas_url
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.models.llm import Model, Provider
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_confirmed_storyboard_basis_is_rechecked_then_frozen(tmp_path, monkeypatch):
    """对象任务和原文变化要求重新确认，已受理请求仍使用原依据。"""
    excerpt = '兄弟在'
    scripts = []

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            if 'storyboard_draft' in json.loads(messages[1].content):
                return SimpleNamespace(content='{"issues": []}')
            args = json.loads(messages[1].content)
            if 'mode' not in args:
                return SimpleNamespace(content='{"objects":[]}')
            scripts.append((args['script_text'], args['objects']))
            return SimpleNamespace(content=json.dumps({'shots': [{'id': 'shot', 'excerpt': excerpt}]}))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='basis-provider', name='openai', base_url='https://story.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='basis-model', name='text', category='text', provider_id='basis-provider'))

        async def data(response):
            assert response.is_success, response.text
            return response.json()['data']

        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = await data(await client.get(chapter))
        scene = await data(await client.post(chapter + '/sequences', json={
            'title': '场次', 'position': 0, 'source_version': source['source_version'],
            'span': {'start': 0, 'end': len(excerpt)},
        }))
        path = chapter + '/sequences/' + scene['id']
        tasks = path + '/storyboards'
        basis_path = tasks + '/basis'
        initial = await data(await client.get(basis_path))
        assert initial['source_text'] == excerpt
        assert not initial['preparation_revision'] and initial['objects'] == []
        request = {'request_id': 'create-storyboard', 'name': '方案', 'text_model_id': 'basis-model',
                   'basis_token': initial['token']}
        await data(await client.post(path + '/objects/extractions', json={
            'request_id': 'objects-before', 'model_id': 'basis-model',
        }))
        assert (await client.post(tasks, json=request)).status_code == 409
        assert (await data(await client.get(path + '/canvases')))['canvases'] == []
        waiting = await data(await client.get(basis_path))
        assert waiting['object_task_active'] and not waiting['preparation_revision']
        assert (await client.post(tasks, json={**request, 'basis_token': waiting['token']})).status_code == 409

        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            prepared = await data(await client.get(basis_path))
            assert prepared['preparation_revision'] == 1 and prepared['objects'] == []
            await data(await client.post(path + '/objects/extractions', json={
                'request_id': 'objects-again', 'model_id': 'basis-model',
            }))
            waiting_saved = await data(await client.get(basis_path))
            assert waiting_saved['object_task_active'] and waiting_saved['preparation_revision'] == 1
            request['basis_token'] = waiting_saved['token']
            assert (await client.post(tasks, json=request)).status_code == 409
            request['use_saved_objects'] = True
            accepted = await data(await client.post(tasks, json=request))
            assert accepted['status'] == 'queued'
            await data(await client.patch('/api/v1/studio/chapters/ch1', json={'raw_text': '已修改的章节正文。'}))
            changed = await data(await client.get(basis_path))
            assert changed['source_changed'] and changed['source_text'] == excerpt
            assert changed['token'] != request['basis_token']
            replay = await data(await client.post(tasks, json=request))
            assert replay['task_id'] == accepted['task_id'] and replay['canvas_id'] == accepted['canvas_id']
            assert len((await data(await client.get(path + '/canvases')))['canvases']) == 1
            assert (await client.post(tasks, json={**request, 'request_id': 'stale-basis'})).status_code == 409
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            assert scripts == [(excerpt, [])]
            updated = await data(await client.get(chapter))
            current = updated['sequences'][0]
            await data(await client.put(path, json={
                'title': current['title'], 'position': current['position'],
                'expected_version': current['version'], 'source_version': updated['source_version'],
                'span': {'start': 0, 'end': 3},
            }))
            stale = await data(await client.get(basis_path))
            assert stale['preparation_stale'] and not stale['source_changed']
            assert (await client.post(tasks, json={**request, 'request_id': 'stale-objects',
                'basis_token': stale['token']})).status_code == 422
        finally:
            worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_blank_canvas_can_recover_original_request_without_duplication(tmp_path):
    """重放同一空白画布请求返回同一身份，改名不会改变原回执。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = (await client.get(chapter)).json()['data']
        created = await client.post(chapter + '/sequences', json={
            'title': '场次', 'position': 0, 'source_version': source['source_version'], 'span': {'start': 0, 'end': 3},
        })
        assert created.is_success, created.text
        path = chapter + '/sequences/' + created.json()['data']['id'] + '/canvases'
        command = {'name': '空白', 'request_id': 'recoverable-blank'}
        accepted = await client.post(path, json=command)
        assert accepted.is_success, accepted.text
        canvas = accepted.json()['data']
        assert [card['type'] for card in canvas['document']['cards']] == ['content.basis']
        renamed = await client.put(canvas_url('/api/v1/studio/generation-canvases/p1/') + canvas['id'], json={
            'request_id': 'rename-blank', 'expected_revision': canvas['revision'],
            'document': {**canvas['document'], 'name': '后来改名'},
        })
        assert renamed.is_success, renamed.text
        replay = await client.post(path, json=command)
        assert replay.json()['data'] == canvas
        assert (await client.post(path, json={**command, 'name': '不同的创建请求'})).status_code == 409
        assert len((await client.get(path)).json()['data']['canvases']) == 1


@pytest.mark.asyncio
async def test_basis_reports_current_reference_state_without_freezing_images(tmp_path):
    """当前主图状态不改变依据身份，资源绑定失效仍改变依据。"""
    from hashlib import sha256
    from app.models.directing import Sequence
    from app.models.studio import Character, CharacterImage
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = (await client.get(chapter)).json()['data']
        scene = (await client.post(chapter + '/sequences', json={
            'title': '场次', 'position': 0, 'source_version': source['source_version'],
            'span': {'start': 0, 'end': 3},
        })).json()['data']
        async with sessions.begin() as db:
            db.add(Character(id='person', project_id='p1', name='演员', style='真人都市'))
            row = await db.get(Sequence, scene['id'])
            digest = sha256(f"{row.source['version']}:{row.source_start}:{row.source_text}".encode()).hexdigest()
            row.object_preparation = {'revision': 1, 'source_digest': digest, 'objects': [
                {'id': 'a', 'kind': 'character', 'name': '甲', 'description': '', 'excerpt': '兄弟在', 'span': {'start': 0, 'end': 3}, 'asset_id': 'person'},
                {'id': 'b', 'kind': 'character', 'name': '乙', 'description': '', 'excerpt': '兄弟在', 'span': {'start': 0, 'end': 3}},
                {'id': 'c', 'kind': 'character', 'name': '丙', 'description': '', 'excerpt': '兄弟在', 'span': {'start': 0, 'end': 3}, 'asset_id': 'deleted'},
            ]}
        url = chapter + '/sequences/' + scene['id'] + '/storyboards/basis'
        response = await client.get(url)
        assert response.is_success, response.text
        before = response.json()['data']
        assert [item['reference_state'] for item in before['objects']] == ['missing', 'unassociated', 'unavailable']
        async with sessions.begin() as db:
            db.add(CharacterImage(id=991, character_id='person', file_id='image1', is_primary=True))
        ready = (await client.get(url)).json()['data']
        assert ready['objects'][0]['reference_state'] == 'ready'
        assert ready['objects'][0]['image_file_id'] is None
        assert ready['token'] == before['token']
        async with sessions.begin() as db:
            row = await db.get(Character, 'person')
            row.project_id = 'p2'
        unavailable = (await client.get(url)).json()['data']
        assert unavailable['objects'][0]['reference_state'] == 'unavailable'
        assert unavailable['token'] != before['token']
