"""场次画布列表按真实任务和文档报告状态。"""

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.models.llm import Model, Provider
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_scene_canvas_summaries_keep_pending_and_adopted_sources_separate(tmp_path, monkeypatch):
    """同场画布独立显示任务，应用回执不能代表撤销后的当前采用来源。"""
    excerpt = '兄弟在'

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, _messages):
            return SimpleNamespace(content=json.dumps({'shots': [{'id': 'shot', 'excerpt': excerpt}]}))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='summary-provider', name='openai', base_url='https://story.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='summary-text', name='text', category='text', provider_id='summary-provider'))

        async def data(response):
            assert response.is_success, response.text
            return response.json()['data']

        chapter_path = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = await data(await client.get(chapter_path))
        scene = await data(await client.post(chapter_path + '/sequences', json={
            'title': '场次', 'position': 0, 'source_version': chapter['source_version'],
            'span': {'start': 0, 'end': len(excerpt)},
        }))
        scene_path = chapter_path + '/sequences/' + scene['id']
        canvases_path, tasks_path = scene_path + '/canvases', scene_path + '/storyboards'
        config = {'text_model_id': 'summary-text', 'mode': 'faithful'}
        first = await data(await client.post(tasks_path, json={**config, 'name': '初版', 'request_id': 'first'}))
        second = await data(await client.post(tasks_path, json={**config, 'name': '另一个方案', 'request_id': 'second'}))

        async def canvases():
            return {row['id']: row for row in (await data(await client.get(canvases_path)))['canvases']}

        summary = await canvases()
        assert summary[first['canvas_id']]['latest_storyboard']['task_id'] == first['task_id']
        assert summary[second['canvas_id']]['latest_storyboard']['task_id'] == second['task_id']
        assert summary[first['canvas_id']]['latest_storyboard']['status'] == 'queued'

        canvas_path = '/api/v1/studio/generation-canvases/p1/' + second['canvas_id']
        initial = await data(await client.get(canvas_path))
        edited = await data(await client.put(canvas_path, json={
            'expected_revision': initial['revision'], 'request_id': 'manual-edit',
            'document': {**initial['document'], 'name': '人工编辑后的方案'},
        }))
        edited_document = (await data(await client.get(canvas_path)))['document']
        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
        ready = await canvases()
        assert list(ready) == list(summary)
        assert ready[first['canvas_id']]['candidate_storyboard_task_id'] == first['task_id']
        assert not ready[first['canvas_id']]['storyboard_review_required']
        row = ready[second['canvas_id']]
        assert row['candidate_storyboard_task_id'] == second['task_id'] and row['storyboard_review_required']
        assert row['applied_storyboard_task_id'] is None
        assert row['latest_storyboard']['status'] == 'succeeded'
        assert row['name'] == '人工编辑后的方案'
        assert not {'document', 'candidate', 'input_snapshot'} & row.keys()

        task_path = tasks_path + '/' + second['task_id']
        applied = await data(await client.post(task_path + '/apply', json={'expected_revision': edited['revision']}))
        row = (await canvases())[second['canvas_id']]
        assert row['applied_storyboard_task_id'] == second['task_id']
        assert row['candidate_storyboard_task_id'] is None

        await data(await client.post(task_path + '/restore', json={
            'request_id': 'undo-summary', 'expected_revision': applied['revision'],
            'direction': 'undo', 'document': edited_document,
        }))
        row = (await canvases())[second['canvas_id']]
        assert row['latest_storyboard']['status'] == 'succeeded'
        assert row['applied_storyboard_task_id'] is None
        assert row['candidate_storyboard_task_id'] is None
