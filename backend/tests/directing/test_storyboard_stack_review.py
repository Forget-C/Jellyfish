"""Reviewed storyboard applications preserve the shared canvas stack guard."""

from tests.canvas_urls import append_canvas_path, canvas_url
import asyncio
import json
from types import SimpleNamespace

from tests.directing.storyboard_prompt_fixture import video_prompt_response

import pytest

from app.models.llm import Model, Provider
from app.models.studio import Chapter
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database


@pytest.mark.asyncio
@pytest.mark.parametrize('reorganized', [False, True])
async def test_storyboard_stack_changes_require_exact_review_and_restore_as_one_operation(tmp_path, monkeypatch, reorganized):
    original = '小雨在侧光和顶光之间推门。小雨关灯。小雨离开。'
    shots = [{'id': key, 'excerpt': excerpt} for key, excerpt in (
        ('door', '小雨在侧光和顶光之间推门。'), ('light', '小雨关灯。'), ('leave', '小雨离开。'))]
    design = {'id': 'direction', 'card_type': 'direction.lighting',
              'fields': {'light_direction': {'state': 'fact', 'text': '侧光', 'excerpt': '小雨在侧光和顶光之间推门'}}}
    shots[0]['designs'] = [design]

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, _messages):
            if response := video_prompt_response(_messages):
                return response
            if 'storyboard_draft' in json.loads(_messages[1].content):
                return SimpleNamespace(content='{"issues": []}')
            return SimpleNamespace(content=json.dumps({'shots': shots}, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='story-provider', provider_key='openai', name='openai', base_url='https://story.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='story-text', name='text', category='text', provider_id='story-provider'))

        async def data(response):
            assert response.status_code == 200, response.text
            return response.json()['data']

        async def complete(path, task):
            worker = TaskWorker(sessions)
            try:
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
            finally:
                worker.text_pool.shutdown(wait=False)
            ready = await data(await client.get(append_canvas_path(path, f"/{task['task_id']}")))
            assert ready['status'] == 'succeeded', ready
            return ready

        base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = await data(await client.get(base))
        scene = await data(await client.post(base + '/sequences', json={'title': '场次', 'position': 0,
            'source_version': chapter['source_version'], 'span': {'start': 0, 'end': len(original)}}))
        scene_path = (base + f"/sequences/{scene['id']}")
        path = scene_path + '/storyboards'
        command = {'request_id': 'first', 'text_model_id': 'story-text', 'mode': 'faithful', 'pending_modality': 'video'}
        first = await complete(path, await data(await client.post(path, json=command)))
        canvas_id = first['canvas_id']
        canvas = canvas_url('/api/v1/studio/generation-canvases/p1/') + canvas_id
        initial_document = first['candidate']['document']
        await data(await client.put(canvas, json={'request_id': 'storyboard:' + first['task_id'],
            'expected_revision': 0, 'document': initial_document}))
        current = await data(await client.get(canvas))
        document = current['document']
        edited = next(card for card in document['cards'] if card['type'] == 'direction.lighting')
        edited['fields']['light_direction'].update(text='人工布光', authorship='user')
        first_shot, second_shot, third_shot = document['storyboard']['shots']

        def stack_for(shot):
            return next(group for group in document['groups'] if group['kind'] == 'stack' and shot['card_id'] in group['card_ids'])

        automatic, manual, unchanged = map(stack_for, (first_shot, second_shot, third_shot))
        unstacked = await data(await client.put(canvas, json={'request_id': 'unstack-and-edit',
            'expected_revision': current['revision'], 'document': {**document,
                'groups': [group for group in document['groups'] if group['id'] != automatic['id']]}}))
        if reorganized:
            automatic['id'] += '-a1b2c3d4'
        manual['id'] = 'manually-regrouped'
        manual['name'] = '手工堆叠'
        before = await data(await client.put(canvas, json={'request_id': 'manual-group',
            'expected_revision': unstacked['revision'], 'document': document}))

        design['fields']['light_direction']['text'] = '顶光'
        # Replace the second shot without changing the third shot ordinal.
        shots[1] = {'id': 'replacement', 'excerpt': '小雨关灯。'}
        reextract = await complete(path, await data(await client.post(append_canvas_path(scene_path, f'/canvases/{canvas_id}/storyboards'),
            json={**command, 'request_id': 'reextract'})))
        application = append_canvas_path(path, f"/{reextract['task_id']}")
        unselected = await data(await client.post(application + '/diff', json={'expected_revision': before['revision']}))
        assert unselected['automatic_stacks'] == []
        choice = {'expected_revision': before['revision'], 'overwrite_card_ids': [edited['id']]}
        diff = await data(await client.post(application + '/diff', json=choice))
        assert diff['automatic_stacks'] == [{'id': automatic['id'], 'name': automatic['name']}]
        assert diff['manual_stacks'] == [{'id': manual['id'], 'name': manual['name']}]
        assert diff['continuity_review']['stale']
        reviewed = await complete(path, await data(await client.post(application + '/retry',
            json={'request_id': 'review-overwrite', 'review_plan': choice})))
        application = append_canvas_path(path, f"/{reviewed['task_id']}")
        confirmed = {'confirmed_auto_stack_ids': [automatic['id']]}
        blocked = await client.post(application + '/apply', json={**choice, **confirmed})
        assert blocked.status_code == 422 and blocked.json()['data']['code'] == 'STACK_READ_ONLY', blocked.text
        assert (await data(await client.get(canvas)))['revision'] == before['revision']

        document = (await data(await client.get(canvas)))['document']
        document['groups'] = [group for group in document['groups'] if group['id'] != manual['id']]
        await data(await client.put(canvas, json={'request_id': 'manual-unstack',
            'expected_revision': before['revision'], 'document': document}))
        before = await data(await client.get(canvas))
        choice['expected_revision'] = before['revision']
        for wrong in ({}, {'confirmed_auto_stack_ids': [automatic['id'], unchanged['id']]}):
            rejected = await client.post(application + '/apply', json={**choice, **wrong})
            assert rejected.status_code == 422, rejected.text
            assert (await data(await client.get(canvas))) == before

        applied = await data(await client.post(application + '/apply', json={**choice, **confirmed}))
        assert applied['revision'] == before['revision'] + 1
        assert automatic['id'] not in {group['id'] for group in applied['document']['groups']}
        assert unchanged in applied['document']['groups']
        assert await data(await client.post(application + '/apply', json={**choice, **confirmed})) == applied
        restored = await data(await client.post(application + '/restore', json={'request_id': 'undo',
            'expected_revision': applied['revision'], 'direction': 'undo', 'document': before['document']}))
        assert restored['document'] == before['document']
