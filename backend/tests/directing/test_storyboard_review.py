"""The scene task and both candidate application routes enforce continuity review."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.models.llm import Model, Provider
from app.models.studio import Chapter
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database
from tests.directing.test_storyboard_scope import read_data


@pytest.mark.asyncio
@pytest.mark.parametrize(('failure', 'kind'), [
    ('timeout', 'conflict'), ('invalid', 'conflict'), ('unknown_shot', 'insufficient_basis'),
])
async def test_review_retry_uses_the_retained_draft_and_protects_application(tmp_path, monkeypatch, failure, kind):
    original = '张三站在车旁不动。镜头切到张三右手。'
    drafts = []
    reviews = []

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            args = json.loads(messages[1].content)
            if 'storyboard_draft' in args:
                reviews.append(args['storyboard_draft'])
                if len(reviews) == 1:
                    if failure == 'timeout':
                        raise httpx.ReadTimeout('controlled review timeout')
                    if failure == 'invalid':
                        return SimpleNamespace(content='unparseable review')
                    return SimpleNamespace(content=json.dumps({'issues': [{'kind': 'conflict', 'shot_ids': ['unknown'],
                        'requirements': '未知镜头', 'suggestion': '无效建议'}]}))
                result = {'issues': [{'kind': kind, 'shot_ids': ['first', 'second'],
                    'requirements': '静止与入场冲突，近景同时要求头、手和双脚；未交代从右手换到左手',
                    'suggestion': '保留原站位和右手，近景只拍手'}]}
            else:
                drafts.append(args)
                result = {'shots': [{'id': 'first', 'excerpt': '张三站在车旁不动。'},
                                    {'id': 'second', 'excerpt': '镜头切到张三右手。'}]}
            return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='review-provider', name='openai', base_url='https://fixture.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='review-text', name='text', category='text', provider_id='review-provider'))
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = await read_data(client, 'GET', chapter)
        scene = await read_data(client, 'POST', chapter + '/sequences', {'title': '张三车旁等待', 'position': 0,
            'source_version': source['source_version'], 'span': {'start': 0, 'end': len(original)}})
        path = chapter + '/sequences/' + scene['id'] + '/storyboards'
        task = await read_data(client, 'POST', path, {'request_id': 'draft', 'text_model_id': 'review-text'})
        canvas_path = '/api/v1/studio/generation-canvases/p1/' + task['canvas_id']
        before = await read_data(client, 'GET', canvas_path)
        worker = TaskWorker(sessions)
        try:
            async def work():
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())

            await work()
            first = await read_data(client, 'GET', path + '/' + task['task_id'])
            assert first['status'] == 'failed' and first['review_state'] == 'incomplete'
            assert first['candidate'] is None
            assert await read_data(client, 'GET', canvas_path) == before
            retry_path = path + '/' + first['task_id'] + '/retry'
            basis = await read_data(client, 'GET', retry_path + '/basis')
            assert basis['review_only'] and basis['basis']['source_text'] == original
            retry_request = {'request_id': 'retry-review', 'basis_token': basis['basis']['token']}
            retry = await read_data(client, 'POST', retry_path, retry_request)
            assert await read_data(client, 'POST', retry_path, retry_request) == retry
            assert retry['canvas_id'] == task['canvas_id']
            await work()
            completed = await read_data(client, 'GET', path + '/' + retry['task_id'])
            assert len(drafts) == 1 and reviews[0] == reviews[1]
            assert completed['status'] == 'succeeded'
            assert completed['pending_application'] and completed['review']['issues'][0]['shot_ids'] == ['first', 'second']
            assert await read_data(client, 'GET', canvas_path) == before
            candidate = completed['candidate']
            application = path + '/' + retry['task_id'] + '/apply'
            if kind == 'conflict':
                assert completed['review_state'] == 'conflict'
                for request_id in ('storyboard:' + retry['task_id'], 'custom-request'):
                    response = await client.put(canvas_path, json={'request_id': request_id,
                        'expected_revision': before['revision'], 'document': candidate['document']})
                    assert response.status_code == 409 and response.json()['data']['code'] == 'STORYBOARD_REVIEW_REQUIRED'
                response = await client.post(application, json={'expected_revision': before['revision']})
                assert response.status_code == 409 and response.json()['data']['code'] == 'STORYBOARD_REVIEW_REQUIRED'
                assert await read_data(client, 'GET', canvas_path) == before
            else:
                assert completed['review_state'] == 'warning'
                manual = await read_data(client, 'PUT', canvas_path, {'request_id': 'user-edit',
                    'expected_revision': before['revision'], 'document': {**before['document'], 'name': '保留人工修改'}})
                request_id = 'custom-request'
                response = await client.put(canvas_path, json={'request_id': request_id,
                    'expected_revision': manual['revision'], 'document': candidate['document']})
                assert response.status_code == 409 and response.json()['data']['code'] == 'STORYBOARD_APPLICATION_REVIEW_REQUIRED'
                applied = await read_data(client, 'POST', application, {'expected_revision': manual['revision']})
                assert applied['document']['name'] == '保留人工修改'
                assert applied['document']['storyboard']['task_id'] == retry['task_id']
        finally:
            worker.text_pool.shutdown(wait=False)
