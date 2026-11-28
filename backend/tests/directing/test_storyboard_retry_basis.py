"""通过公共接口核对失败任务重试的本次输入和已受理结果。"""

from tests.canvas_urls import canvas_url
import asyncio
import json
from types import SimpleNamespace

from tests.directing.storyboard_prompt_fixture import video_prompt_response

import pytest

from app.models.llm import Model, Provider
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_storyboard_retry_confirms_current_basis_and_recovers_same_canvas(tmp_path, monkeypatch):
    """取消的任务可重试，旧的核对不会覆盖其后发生的画布修改。"""
    excerpt = '兄弟在'
    observed = []

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            if response := video_prompt_response(messages):
                return response
            if 'storyboard_draft' in json.loads(messages[1].content):
                return SimpleNamespace(content='{"issues": []}')
            args = json.loads(messages[1].content)
            observed.append((args['mode'], args['script_text'], args['objects']))
            return SimpleNamespace(content=json.dumps({'shots': [{'id': 'shot', 'excerpt': excerpt}]}))

    monkeypatch.setattr('app.task_worker.build_langchain_chat', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='retry-provider', provider_key='openai', name='openai', base_url='https://story.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='retry-text', name='重试文本模型', category='text', provider_id='retry-provider'))

        async def data(response):
            assert response.is_success, response.text
            return response.json()['data']

        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = await data(await client.get(chapter))
        scene = await data(await client.post(chapter + '/sequences', json={
            'title': '场次', 'position': 0, 'source_version': source['source_version'],
            'span': {'start': 0, 'end': len(excerpt)},
        }))
        scene_path = chapter + '/sequences/' + scene['id']
        tasks = scene_path + '/storyboards'
        original = await data(await client.post(tasks, json={
            'request_id': 'original', 'mode': 'faithful', 'pending_modality': 'video',
            'text_model_id': 'retry-text', 'name': '保留这个画布',
        }))
        retry = tasks + '/' + original['task_id'] + '/retry'
        assert (await client.get(retry + '/basis')).status_code == 409
        await data(await client.post('/api/v1/film/tasks/' + original['task_id'] + '/cancel', json={}))
        preview = await data(await client.get(retry + '/basis'))
        assert preview['mode'] == 'faithful' and preview['text_model_name'] == '重试文本模型'
        assert preview['pending_modality'] == 'video' and preview['production_model_id'] is None
        assert preview['canvas_id'] == original['canvas_id']
        assert preview['basis']['source_text'] == excerpt and preview['basis']['objects'] == []
        assert (await client.get((retry + '/basis').replace('/p1/', '/p2/'))).status_code == 404

        canvas_path = canvas_url('/api/v1/studio/generation-canvases/p1/') + original['canvas_id']
        canvas = await data(await client.get(canvas_path))
        document = {**canvas['document'], 'name': '保留人工修改'}
        saved = await data(await client.put(canvas_path, json={'request_id': 'edit-before-retry',
            'expected_revision': canvas['revision'], 'document': document}))
        await data(await client.patch('/api/v1/studio/chapters/ch1', json={'raw_text': '新正文待核对。'}))
        command = {'request_id': 'confirmed-retry', 'basis_token': preview['basis']['token']}
        assert (await client.post(retry, json=command)).status_code == 409
        updated = await data(await client.get(retry + '/basis'))
        assert updated['basis']['source_changed'] and updated['basis']['source_text'] == excerpt
        assert updated['source_kind'] == 'fixed'
        command['basis_token'] = updated['basis']['token']
        accepted = await data(await client.post(retry, json=command))
        assert accepted['canvas_id'] == original['canvas_id'] and accepted['task_id'] != original['task_id']
        assert accepted['status'] == 'queued'
        assert (await client.get(retry + '/basis')).status_code == 409
        assert (await client.post(retry, json={**command, 'request_id': 'different-retry'})).status_code == 409
        assert (await data(await client.post(retry, json=command)))['task_id'] == accepted['task_id']
        assert len((await data(await client.get(scene_path + '/canvases')))['canvases']) == 1

        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
        candidate = await data(await client.get(tasks + '/' + accepted['task_id']))
        assert candidate['status'] == 'succeeded' and candidate['pending_application']
        assert candidate['candidate']['base_revision'] == saved['revision']
        assert (await data(await client.get(canvas_path)))['document'] == document
        assert observed == [('faithful', excerpt, [])]

        chapter_read = await data(await client.get(chapter))
        draft = {'source_version': chapter_read['source_version'], 'baseline': [
            {'sequence_id': item['id'], 'version': item['version']} for item in chapter_read['sequences']],
            'members': [], 'lineage': [{'sequence_id': scene['id'], 'target_keys': []}], 'exited_sequence_ids': [scene['id']]}
        retirement = await data(await client.post(chapter + '/division/preview', json=draft))
        await data(await client.put(chapter + '/division', json={'request_id': 'retire-retry-target',
            'draft': draft, 'preview_token': retirement['preview_token'], 'identity_changes_confirmed': True}))
        archived = await client.get(retry + '/basis')
        assert archived.status_code == 409 and '历史场次' in archived.text
        archived = await client.post(retry, json={**command, 'request_id': 'new-on-history'})
        assert archived.status_code == 409 and '历史场次' in archived.text
        assert (await data(await client.post(retry, json=command)))['task_id'] == accepted['task_id']
