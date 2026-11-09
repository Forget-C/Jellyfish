"""Faithful scene extraction through public task and common canvas APIs."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.models.llm import Model, Provider
from app.models.studio import Chapter
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_faithful_storyboard_builds_real_canvas_candidate_with_verified_source(tmp_path, monkeypatch):
    """The worker corrects invalid source evidence before a candidate can be saved."""
    original = '🌱小雨推门。小雨关灯。'
    result = {
        'missed_objects': [{'id': 'rain', 'kind': 'character', 'name': '小雨', 'excerpt': '小雨推门'}],
        'shots': [
            {'id': 'open', 'excerpt': '小雨推门。', 'object_ids': ['rain'], 'designs': [
                {'id': 'action', 'card_type': 'direction.performance', 'object_id': 'rain',
                 'fields': {'physical_action': {'state': 'fact', 'text': '推门', 'excerpt': '小雨推门'}}}]},
            {'id': 'close', 'excerpt': '小雨关灯。', 'object_ids': ['rain']},
        ],
    }
    calls = []

    class ControlledModel:
        """Only the external text response is controlled."""

        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            calls.append(str(messages))
            output = {'shots': [{'id': 'bad', 'excerpt': '不存在的原文'}]} if len(calls) not in (2, 3) else result
            return SimpleNamespace(content=json.dumps(output, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='story-provider', name='openai', base_url='https://story.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='story-text', name='text', category='text', provider_id='story-provider'))
        base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = (await client.get(base)).json()['data']
        scene = await client.post(base + '/sequences', json={'title': '场次', 'position': 0,
            'source_version': chapter['source_version'], 'span': {'start': 0, 'end': len(original)}})
        assert scene.status_code == 200, scene.text
        path = base + '/sequences/' + scene.json()['data']['id'] + '/storyboards'
        request = {'request_id': 'first', 'name': '忠实稿', 'text_model_id': 'story-text'}
        submitted = await client.post(path, json=request)
        assert submitted.status_code == 200, submitted.text
        task = submitted.json()['data']
        assert (await client.post(path, json=request)).json()['data']['task_id'] == task['task_id']
        assert task['status'] == 'queued'
        async def complete_task():
            worker = TaskWorker(sessions)
            try:
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
            finally:
                worker.text_pool.shutdown(wait=False)

        await complete_task()
        completed = await client.get(path + '/' + task['task_id'])
        assert completed.status_code == 200, completed.text
        ready = completed.json()['data']
        assert ready['status'] == 'succeeded', ready
        assert len(calls) == 2
        assert (await client.get((path + '/' + task['task_id']).replace('/p1/', '/p2/'))).status_code == 404
        candidate = ready['candidate']
        document = candidate['document']
        cards = document['cards']
        assert len([card for card in cards if card['type'] == 'content.character']) == 1
        refs = [card for card in cards if card['type'] == 'reference.character']
        assert len(refs) == 1 and refs[0]['image_binding'] is None
        shots = [card for card in cards if card['type'] == 'direction.shot']
        assert [card['visible_result']['text'] for card in shots] == ['小雨推门。', '小雨关灯。']
        assert all(card['estimated_duration']['state'] == 'undecided' for card in shots)
        models = [card for card in cards if card['type'] == 'model.image']
        assert len(models) == 2 and all(not card['model_id'] for card in models)
        assert all(not any(binding['input_port'] == 'image' for binding in card['input_bindings']) for card in models)
        assert document['storyboard']['origins'][shots[0]['id']]['sources'][0]['start'] == 1
        assert document['storyboard']['task_id'] == task['task_id']

        canvas_path = '/api/v1/studio/generation-canvases/p1/' + task['canvas_id']
        before = (await client.get(canvas_path)).json()['data']
        assert before['revision'] == candidate['base_revision'] == 0
        assert [card['type'] for card in before['document']['cards']] == ['content.basis']
        save = await client.put(canvas_path, json={'request_id': 'storyboard:' + task['task_id'],
            'expected_revision': candidate['base_revision'], 'document': document})
        assert save.status_code == 200, save.text
        opened = (await client.get(canvas_path)).json()['data']
        assert opened['document']['storyboard']['task_id'] == task['task_id']
        edited = opened['document']
        performance = next(card for card in edited['cards'] if card['type'] == 'direction.performance')
        performance['physical_action'].update(text='缓慢推门', authorship='user', purpose='constraint')
        save = await client.put(canvas_path, json={'request_id': 'manual', 'expected_revision': opened['revision'], 'document': edited})
        assert save.status_code == 200, save.text
        persisted = (await client.get(canvas_path)).json()['data']['document']
        field = next(card for card in persisted['cards'] if card['id'] == performance['id'])['physical_action']
        assert field['authorship'] == 'user' and field['state'] == 'fact' and field['purpose'] == 'constraint'
        assert field['source_locator'] == '小雨推门'
        assert persisted['storyboard']['origins'][performance['id']]['manually_edited']

        late = (await client.post(path, json={**request, 'request_id': 'late'})).json()['data']
        late_path = '/api/v1/studio/generation-canvases/p1/' + late['canvas_id']
        prior = (await client.get(late_path)).json()['data']
        save = await client.put(late_path, json={'request_id': 'user-first', 'expected_revision': prior['revision'],
            'document': {**prior['document'], 'name': '人工先保存'}})
        assert save.status_code == 200, save.text
        await complete_task()
        pending = (await client.get(path + '/' + late['task_id'])).json()['data']
        assert pending['status'] == 'succeeded' and pending['pending_application']
        assert pending['candidate']['base_revision'] == 0
        conflict = await client.put(late_path, json={'request_id': 'storyboard:' + late['task_id'],
            'expected_revision': pending['candidate']['base_revision'], 'document': pending['candidate']['document']})
        assert conflict.status_code == 409
        untouched = (await client.get(late_path)).json()['data']
        assert untouched['document']['name'] == '人工先保存' and 'storyboard' not in untouched['document']
        rejected = (await client.post(path, json={**request, 'request_id': 'unrepairable'})).json()['data']
        await complete_task()
        failed = (await client.get(path + '/' + rejected['task_id'])).json()['data']
        assert failed['status'] == 'failed' and failed['candidate'] is None
        assert len(calls) == 5, 'one initial request and at most one correction per task'
        rejected_path = '/api/v1/studio/generation-canvases/p1/' + rejected['canvas_id']
        after_failure = (await client.get(rejected_path)).json()['data']
        assert after_failure['revision'] == 0 and len(after_failure['document']['cards']) == 1
        tasks = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
        assert {item['task_kind'] for item in tasks} == {'directing_storyboard'}
