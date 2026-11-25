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
        {'objects': [{**first, 'name': '前门来客'}, {'kind': 'prop', 'name': '信封', 'excerpt': '拿着信封'}]},
        {'objects': [first, second]},
    ])
    calls = []

    class ControlledModel:
        """只替换外部文字生成，保留真实任务执行。"""
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            calls.append(str(messages))
            return SimpleNamespace(content=json.dumps(next(responses), ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.build_langchain_chat', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='object-provider', provider_key='openai', name='openai', base_url='https://fixture.test/v1', api_key='fixture'))
            await db.flush()
            db.add(Model(id='object-model', name='fixture-text', category='text', provider_id='object-provider', params={}))
            db.add_all([Character(id='front-asset', project_id='p1', name='前门角色', style='真人都市'),
                        Character(id='foreign-asset', project_id='p2', name='外部角色', style='真人都市')])
            await db.flush()
            db.add(CharacterImage(character_id='front-asset', file_id='image1', is_primary=True))
        base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = (await client.get(base)).json()['data']
        scene = await client.post(base + '/sequences', json={'title': '测试场次', 'position': 0,
            'source_version': chapter['source_version'], 'span': {'start': 0, 'end': len(original)}})
        assert scene.status_code == 200, scene.text
        endpoint = base + '/sequences/' + scene.json()['data']['id'] + '/objects'
        request = {'request_id': 'extract-once', 'model_id': 'object-model'}
        admitted = await client.post(endpoint + '/extractions', json=request)
        assert admitted.status_code == 200, admitted.text
        queued_path = endpoint + '/extractions/' + admitted.json()['data']['task_id'] + '/candidate'
        queued_details = await client.get(queued_path)
        assert queued_details.status_code == 200, queued_details.text
        assert queued_details.json()['data']['task']['status'] == 'queued'
        assert not queued_details.json()['data']['candidate_available']
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
            choice = {'expected_revision': ready['revision'], 'asset_id': 'front-asset'}
            assert (await client.put(object_url, json={**choice, 'asset_id': 'foreign-asset'})).status_code == 422
            assert (await client.put(object_url, json={**choice, 'image_file_id': 'video1'})).status_code == 422
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
            failed_details = await client.get(endpoint + '/extractions/' + failed['task']['task_id'] + '/candidate')
            assert failed_details.status_code == 200, failed_details.text
            assert failed_details.json()['data']['task']['status'] == 'failed'
            assert not failed_details.json()['data']['candidate_available']
            assert failed['objects'] == selected['objects']
            assert len(calls) == 4

            successful_retry = await client.post(endpoint + '/extractions', json={**request, 'request_id': 'valid-retry'})
            assert successful_retry.status_code == 200, successful_retry.text
            refreshed = await run()
            assert refreshed['task']['status'] == 'succeeded'
            assert refreshed['objects'] == selected['objects']
            assert refreshed['revision'] == selected['revision']
            candidate_path = endpoint + '/extractions/' + successful_retry.json()['data']['task_id']
            assert refreshed['candidate_task_id'] == successful_retry.json()['data']['task_id']
            result = await client.get(candidate_path + '/candidate')
            assert result.status_code == 200, result.text
            preview = result.json()['data']
            assert [item['name'] for item in preview['added']] == ['信封']
            assert [item['excerpt'] for item in preview['removed']] == ['后门的阿同']
            assert preview['modified'][0]['id'] == selected['objects'][0]['id']
            assert preview['modified'][0]['name'] == '前门来客'
            assert preview['retained_choices'][0]['asset_id'] == 'front-asset'

            concurrent = await client.post(endpoint + '/extractions', json={**request, 'request_id': 'concurrent'})
            assert concurrent.status_code == 200, concurrent.text
            edited = await client.put(object_url, json={**choice, 'expected_revision': refreshed['revision'], 'asset_id': None})
            assert edited.status_code == 200, edited.text
            preserved = await run()
            assert preserved['task']['status'] == 'succeeded'
            assert preserved['candidate_task_id'] == concurrent.json()['data']['task_id']
            assert preserved['revision'] == edited.json()['data']['revision']
            assert preserved['objects'] == edited.json()['data']['objects']
            assert (await client.get(candidate_path.replace('/p1/', '/p2/') + '/candidate')).status_code == 404

            async def review(path=candidate_path):
                response = await client.get(path + '/candidate')
                assert response.status_code == 200, response.text
                return response.json()['data']

            def apply_command(value):
                return {'expected_revision': value['revision'], 'preview_token': value['preview_token']}

            old_apply = await client.post(candidate_path + '/apply', json=apply_command(preview))
            assert old_apply.status_code == 409, old_apply.text
            rebased = await review()
            assert rebased['retained_choices'] == []
            restored = await client.put(object_url, json={**choice, 'expected_revision': rebased['revision']})
            assert restored.status_code == 200, restored.text
            assert (await client.post(candidate_path + '/apply', json=apply_command(rebased))).status_code == 409
            confirmed = await review()
            assert confirmed['retained_choices'][0]['asset_id'] == 'front-asset'
            command = apply_command(confirmed)
            wrong_task = await client.post(candidate_path.replace('/p1/', '/p2/') + '/apply', json=command)
            assert wrong_task.status_code == 404
            applied, chosen = await asyncio.gather(
                client.post(candidate_path + '/apply', json=command),
                client.put(object_url, json={**choice, 'expected_revision': confirmed['revision']}),
            )
            assert sorted((applied.status_code, chosen.status_code)) == [200, 409]
            if chosen.status_code == 200:
                confirmed = await review()
                command = apply_command(confirmed)
                applied = await client.post(candidate_path + '/apply', json=command)
            assert applied.status_code == 200, applied.text
            assert (await client.post(candidate_path + '/apply', json=command)).json() == applied.json()
            adopted = await read_objects()
            assert adopted['revision'] == confirmed['revision'] + 1
            assert adopted['revision'] == applied.json()['data']['revision']
            assert [(item['name'], item['image_file_id']) for item in adopted['objects']] == [('前门来客', 'image1'), ('信封', None)]
            assert (await review())['applied_revision'] == adopted['revision']
            assert len(calls) == 6

            pending_path = endpoint + '/extractions/' + concurrent.json()['data']['task_id']
            before_source = await review(pending_path)
            new_text = original + '远景。'
            assert (await client.patch('/api/v1/studio/chapters/ch1', json={'raw_text': new_text})).status_code == 200
            assert (await review(pending_path))['preview_token'] == before_source['preview_token']
            current_chapter = (await client.get(base)).json()['data']
            scene_path = endpoint.removesuffix('/objects')
            scene_row = current_chapter['sequences'][0]
            reconfirmed = await client.put(scene_path, json={'title': scene_row['title'], 'position': scene_row['position'],
                'expected_version': scene_row['version'], 'source_version': current_chapter['source_version'],
                'span': {'start': 0, 'end': len(new_text)}})
            assert reconfirmed.status_code == 200, reconfirmed.text
            stale = await review(pending_path)
            assert stale['source_changed'] and stale['preview_token'] is None
            assert stale['added'] and stale['removed']
            assert (await client.post(pending_path + '/apply', json=apply_command(before_source))).status_code == 409
            assert (await read_objects())['objects'] == adopted['objects']
            before_exit = await read_objects()
            assert (await client.post(candidate_path + '/discard')).status_code == 409
            assert (await client.post(pending_path.replace('/p1/', '/p2/') + '/discard')).status_code == 404
            for _ in range(2):
                exited = await client.post(pending_path + '/discard')
                assert exited.status_code == 200, exited.text
            after_exit = await read_objects()
            assert after_exit['candidate_task_id'] is None
            assert after_exit['objects'] == before_exit['objects']
            assert after_exit['revision'] == before_exit['revision']
            assert not (await review(pending_path))['candidate_available']
            assert (await client.post(pending_path + '/apply', json=apply_command(before_source))).status_code == 409
            tasks = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
            assert {item['task_kind'] for item in tasks} == {'directing_object_extract'}
        finally:
            worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_first_object_result_survives_source_and_membership_changes(tmp_path, monkeypatch):
    """Late first results remain readable and cannot overwrite newly adopted preparation."""
    original = '小雨提包。小雨开门。'
    calls = []

    class ControlledModel:
        """Only the provider response is fixed."""
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            calls.append(str(messages))
            return SimpleNamespace(content='{"objects":[{"kind":"character","name":"小雨","excerpt":"小雨提包"}]}')

    monkeypatch.setattr('app.task_worker.build_langchain_chat', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='object-provider', provider_key='openai', name='openai', base_url='https://fixture.test/v1', api_key='fixture'))
            await db.flush()
            db.add(Model(id='object-model', name='fixture-text', category='text', provider_id='object-provider', params={}))

        def data(response):
            assert response.status_code == 200, response.text
            return response.json()['data']

        base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = data(await client.get(base))
        source = chapter['source_version']
        scene = data(await client.post(base + '/sequences', json={'title': '测试场次', 'position': 0,
            'source_version': source, 'span': {'start': 0, 'end': len(original)}}))
        scene_path = f"{base}/sequences/{scene['id']}"
        objects = scene_path + '/objects'
        worker = TaskWorker(sessions)
        try:
            async def submit(request_id):
                result = data(await client.post(objects + '/extractions', json={'request_id': request_id, 'model_id': 'object-model'}))
                return f"{objects}/extractions/{result['task_id']}"

            async def work():
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())

            async def update_range(row, end):
                return data(await client.put(scene_path, json={'title': row['title'], 'position': row['position'],
                    'expected_version': row['version'], 'source_version': source, 'span': {'start': 0, 'end': end}}))

            first = await submit('stale-first')
            shortened = await update_range(scene, len('小雨提包。'))
            await work()
            stale = data(await client.get(first + '/candidate'))
            assert stale['task']['status'] == 'succeeded' and stale['added'][0]['name'] == '小雨'
            assert stale['source_changed'] and stale['preview_token'] is None
            assert data(await client.get(objects))['revision'] == 0

            scene = await update_range(shortened, len(original))
            second = await submit('first-with-concurrent-application')
            preview = data(await client.get(first + '/candidate'))
            command = {'expected_revision': preview['revision'], 'preview_token': preview['preview_token']}
            adopted = data(await client.post(first + '/apply', json=command))
            assert adopted['revision'] == 1
            await work()
            ready = data(await client.get(second + '/candidate'))
            assert ready['applied_revision'] is None and ready['preview_token']
            assert data(await client.get(objects))['revision'] == 1

            draft = {'source_version': source, 'baseline': [{'sequence_id': scene['id'], 'version': scene['version']}],
                'members': [], 'lineage': [{'sequence_id': scene['id'], 'target_keys': []}],
                'exited_sequence_ids': [scene['id']]}
            division = data(await client.post(base + '/division/preview', json=draft))
            data(await client.put(base + '/division', json={'request_id': 'historical', 'draft': draft,
                'preview_token': division['preview_token'], 'identity_changes_confirmed': True}))
            historical = data(await client.get(second + '/candidate'))
            assert not historical['is_current'] and not historical['source_changed'] and historical['preview_token'] is None
            rejected = await client.post(second + '/apply', json={'expected_revision': ready['revision'],
                'preview_token': ready['preview_token']})
            assert rejected.status_code == 409 and '已退出当前划分' in rejected.text
            assert data(await client.post(first + '/apply', json=command)) == adopted
            assert data(await client.get(objects))['revision'] == 1
            assert len(calls) == 2
        finally:
            worker.text_pool.shutdown(wait=False)
