"""对象候选由真实任务交付，选择只写场次准备。"""
import asyncio
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session
from sqlalchemy.util.concurrency import await_only

from app.models.llm import Model, Provider
from app.models.studio import Chapter, Character, CharacterImage
from app.models.task import Task
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_object_extraction_uses_confirmed_source_and_preserves_candidates_on_failure(tmp_path, monkeypatch):
    """同名对象分开，受控模型的非法出处耗尽纠错后不覆盖准备结果。"""
    original = '前门的阿同拿着信封。后门的阿同等待。'
    first = {'kind': 'character', 'name': '阿同', 'description': '在前门', 'excerpt': '前门的阿同'}
    second = {'kind': 'character', 'name': '阿同', 'description': '在后门', 'excerpt': '后门的阿同'}
    responses = iter([
        {'objects': [{**first, 'asset_id': 'invented'}]}, {'objects': [first, second]},
        {'objects': [{**first, 'excerpt': '不在原文'}]}, {'objects': [{**first, 'excerpt': '仍不在原文'}]},
        {'objects': [first, second]}, {'objects': [first, second]},
    ])
    calls = []

    class ControlledModel:
        """只替换外部文字生成，保留真实任务执行。"""
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            calls.append(str(messages))
            return SimpleNamespace(content=json.dumps(next(responses), ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='object-provider', name='openai', base_url='https://fixture.test/v1', api_key='fixture'))
            await db.flush()
            db.add(Model(id='object-model', name='fixture-text', category='text', provider_id='object-provider', params={}))
            db.add_all([Character(id='front-asset', project_id='p1', name='前门角色', style='真人都市'),
                        Character(id='foreign-asset', project_id='p2', name='外部角色', style='真人都市')])
            await db.flush()
            db.add(CharacterImage(character_id='front-asset', file_id='image1'))
        base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = (await client.get(base)).json()['data']
        scene = await client.post(base + '/sequences', json={'title': '测试场次', 'position': 0,
            'source_version': chapter['source_version'], 'span': {'start': 0, 'end': len(original)}})
        assert scene.status_code == 200, scene.text
        endpoint = base + '/sequences/' + scene.json()['data']['id'] + '/objects'
        request = {'request_id': 'extract-once', 'model_id': 'object-model'}
        admitted = await client.post(endpoint + '/extractions', json=request)
        assert admitted.status_code == 200, admitted.text
        assert (await client.post(endpoint + '/extractions', json=request)).json() == admitted.json()
        assert (await client.post(endpoint + '/extractions', json={**request, 'request_id': 'other'})).status_code == 409
        worker = TaskWorker(sessions)
        try:
            async def work():
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())

            async def read_objects():
                read = await client.get(endpoint)
                assert read.status_code == 200, read.text
                return read.json()['data']

            async def run():
                await work()
                return await read_objects()

            # Let the real worker commit after the scene read but before the task read.
            completed_during_read = False

            def complete_at_task_read(query):
                nonlocal completed_during_read
                columns = getattr(query.statement, 'column_descriptions', ())
                if not completed_during_read and query.is_select and any(column.get('entity') is Task for column in columns):
                    completed_during_read = True
                    await_only(work())

            event.listen(Session, 'do_orm_execute', complete_at_task_read)
            try:
                ready = await read_objects()
            finally:
                event.remove(Session, 'do_orm_execute', complete_at_task_read)
            assert completed_during_read
            assert ready['task']['status'] == 'succeeded', ready
            assert len(ready['objects']) == 2 and ready['objects'][0]['id'] != ready['objects'][1]['id']
            assert [obj['name'] for obj in ready['objects']] == ['阿同', '阿同']
            assert all(obj['reference_state'] == 'unassociated' for obj in ready['objects'])
            assert len(calls) == 2 and original in calls[0]

            object_url = endpoint + '/' + ready['objects'][0]['id']
            choice = {'expected_revision': ready['revision'], 'asset_id': 'front-asset', 'image_file_id': 'image1'}
            assert (await client.put(object_url, json={**choice, 'asset_id': 'foreign-asset'})).status_code == 422
            assert (await client.put(object_url, json={**choice, 'image_file_id': 'video1'})).status_code == 422
            assert (await client.put(endpoint + '/' + ready['objects'][1]['id'], json={**choice, 'asset_id': None})).status_code == 422
            selected = await client.put(object_url, json=choice)
            assert selected.status_code == 200, selected.text
            assert (await client.put(object_url, json=choice)).status_code == 409
            assert (await client.get(endpoint.replace('/p1/', '/p2/'))).status_code == 404
            selected = selected.json()['data']
            assert selected['objects'][0]['reference_state'] == 'ready'
            assert selected['objects'][1]['reference_state'] == 'unassociated'


            retry = await client.post(endpoint + '/extractions', json={**request, 'request_id': 'retry'})
            assert retry.status_code == 200, retry.text
            failed = await run()
            assert failed['task']['status'] == 'failed'
            assert failed['objects'] == selected['objects']
            assert len(calls) == 4

            successful_retry = await client.post(endpoint + '/extractions', json={**request, 'request_id': 'valid-retry'})
            assert successful_retry.status_code == 200, successful_retry.text
            refreshed = await run()
            assert refreshed['task']['status'] == 'succeeded'
            assert refreshed['objects'] == selected['objects']

            concurrent = await client.post(endpoint + '/extractions', json={**request, 'request_id': 'concurrent'})
            assert concurrent.status_code == 200, concurrent.text
            edited = await client.put(object_url, json={**choice, 'expected_revision': refreshed['revision'], 'image_file_id': None})
            assert edited.status_code == 200, edited.text
            preserved = await run()
            assert preserved['task']['status'] == 'failed'
            assert '对象参考已修改' in preserved['task']['error']
            assert preserved['objects'] == edited.json()['data']['objects']
            tasks = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
            assert {item['task_kind'] for item in tasks} == {'directing_object_extract'}
        finally:
            worker.text_pool.shutdown(wait=False)
