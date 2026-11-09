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
            output = {'shots': [{'id': 'bad', 'excerpt': '不存在的原文'}]} if len(calls) not in (2, 3, 6) else result
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
        request = {'request_id': 'first', 'name': '忠实稿', 'text_model_id': 'story-text', 'mode': 'faithful'}
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
        assert document['storyboard']['objects'][0]['origin'] == 'missed'
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
        late_task_path = path + '/' + late['task_id']
        diff = await client.post(late_task_path + '/diff', json={'expected_revision': untouched['revision']})
        assert diff.status_code == 200, diff.text
        assert {item['type'] for item in diff.json()['data']['added']} >= {'direction.shot', 'direction.performance'}
        applied = await client.post(late_task_path + '/apply', json={'expected_revision': untouched['revision']})
        assert applied.status_code == 200, applied.text
        saved = applied.json()['data']
        assert saved['document']['name'] == '人工先保存'
        assert saved == (await client.get(late_path)).json()['data']
        replay = await client.post(late_task_path + '/apply', json={'expected_revision': untouched['revision']})
        assert replay.json()['data'] == saved
        rejected = (await client.post(path, json={**request, 'request_id': 'unrepairable', 'pending_modality': 'video'})).json()['data']
        await complete_task()
        failed = (await client.get(path + '/' + rejected['task_id'])).json()['data']
        assert failed['status'] == 'failed' and failed['candidate'] is None
        assert len(calls) == 5, 'one initial request and at most one correction per task'
        rejected_path = '/api/v1/studio/generation-canvases/p1/' + rejected['canvas_id']
        after_failure = (await client.get(rejected_path)).json()['data']
        assert after_failure['revision'] == 0 and len(after_failure['document']['cards']) == 1
        listed = await client.get(path, params={'canvas_id': rejected['canvas_id']})
        assert listed.status_code == 200, listed.text
        assert [task['task_id'] for task in listed.json()['data']] == [failed['task_id']]
        assert not listed.json()['data'][0]['candidate_available']
        assert (await client.get(path.replace('/p1/', '/p2/'))).status_code == 404
        retry_path = f"{path}/{failed['task_id']}/retry"
        retry_request = {'request_id': 'retry-same-target'}
        retried = await client.post(retry_path, json=retry_request)
        assert retried.status_code == 200, retried.text
        retry = retried.json()['data']
        assert retry['canvas_id'] == rejected['canvas_id'] and retry['task_id'] != failed['task_id']
        assert (await client.post(retry_path, json=retry_request)).json()['data']['task_id'] == retry['task_id']
        assert (await client.post(retry_path, json={'request_id': 'parallel-retry'})).status_code == 409
        assert (await client.post(retry_path.replace('/p1/', '/p2/'), json=retry_request)).status_code == 404
        await complete_task()
        recovered = (await client.get(path + '/' + retry['task_id'])).json()['data']
        assert recovered['status'] == 'succeeded' and recovered['pending_application']
        assert recovered['candidate_available'] and recovered['candidate']['base_revision'] == 0
        pending_models = [card for card in recovered['candidate']['document']['cards'] if card['type'].startswith('model.')]
        assert pending_models and all(card['type'] == 'model.video' and card['model_id'] is None for card in pending_models)
        assert (await client.get(rejected_path)).json()['data'] == after_failure
        tasks = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
        assert {item['task_kind'] for item in tasks} == {'directing_storyboard'}
        assert len(tasks) == 4


@pytest.mark.asyncio
async def test_default_complete_storyboard_keeps_proposals_distinct_from_source_facts(tmp_path, monkeypatch):
    """Both modes run the same task and save path; only complete permits proposals."""
    original = '阿青扶起椅子。'
    fact = {'state': 'fact', 'text': '扶起椅子', 'excerpt': original}
    proposal = {'state': 'proposal', 'text': '以低机位表现起身动作', 'excerpt': original, 'reason': '突出动作变化'}
    shot = {'id': 'action', 'excerpt': original, 'narrative_role': fact}
    complete = {'shots': [{**shot, 'visible_result': proposal, 'designs': [
        {'id': 'camera', 'card_type': 'direction.camera', 'fields': {'viewpoint': proposal}},
        {'id': 'light', 'card_type': 'direction.lighting', 'fields': {'light_direction': {
            'state': 'undecided', 'reason': '待确认场地光线'}}},
    ]}]}
    calls = []

    class ControlledModel:
        """Control only external output and transport failure."""

        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            import httpx
            args = json.loads(messages[1].content)
            calls.append(args['mode'])
            if len(calls) == 5:
                raise httpx.ConnectError('fixture provider unavailable')
            if len(calls) == 1:
                result = {'shots': [{**shot, 'visible_result': {**proposal, 'state': 'fact'}}]}
            else:
                result = {'shots': [shot]} if len(calls) == 4 else complete
            return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='story-modes-provider', name='openai', base_url='https://story.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='story-modes-text', name='text', category='text', provider_id='story-modes-provider'))
        base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = (await client.get(base)).json()['data']
        scene = await client.post(base + '/sequences', json={'title': '场次', 'position': 0,
            'source_version': chapter['source_version'], 'span': {'start': 0, 'end': len(original)}})
        assert scene.status_code == 200, scene.text
        path = base + '/sequences/' + scene.json()['data']['id'] + '/storyboards'
        worker = TaskWorker(sessions)
        try:
            async def extract(request_id, **config):
                response = await client.post(path, json={'request_id': request_id,
                    'text_model_id': 'story-modes-text', **config})
                assert response.status_code == 200, response.text
                task_id = response.json()['data']['task_id']
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
                return (await client.get(path + '/' + task_id)).json()['data']

            expanded = await extract('default-mode')
            assert expanded['status'] == 'succeeded', expanded
            candidate = expanded['candidate']
            assert candidate['document']['storyboard']['mode'] == 'complete'
            canvas_path = '/api/v1/studio/generation-canvases/p1/' + expanded['canvas_id']
            applied = await client.put(canvas_path, json={'request_id': 'storyboard:' + expanded['task_id'],
                'expected_revision': candidate['base_revision'], 'document': candidate['document']})
            assert applied.status_code == 200, applied.text
            saved = (await client.get(canvas_path)).json()['data']
            cards = saved['document']['cards']
            frame = next(card for card in cards if card['type'] == 'direction.shot')
            assert frame['narrative_role']['state'] == 'fact'
            assert frame['visible_result']['state'] == 'proposal'
            assert frame['visible_result']['text'] == proposal['text']
            camera = next(card for card in cards if card['type'] == 'direction.camera')
            assert camera['fields']['viewpoint']['extraction_reason'] == proposal['reason']
            light = next(card for card in cards if card['type'] == 'direction.lighting')
            assert light['fields']['light_direction']['state'] == 'undecided'
            assert light['fields']['light_direction']['text'] == ''
            assert not next(card for card in cards if card['type'] == 'model.image')['model_id']

            faithful = await extract('explicit-faithful', mode='faithful')
            assert faithful['status'] == 'succeeded', faithful
            assert faithful['candidate']['document']['storyboard']['mode'] == 'faithful'
            assert not any(card['type'] == 'direction.camera' for card in faithful['candidate']['document']['cards'])
            assert calls == ['complete', 'complete', 'faithful', 'faithful']

            failed = await extract('provider-failed')
            assert failed['status'] == 'failed' and failed['candidate'] is None and failed['error']
            assert calls == ['complete', 'complete', 'faithful', 'faithful', 'complete']
            assert (await client.get(canvas_path)).json()['data'] == saved
        finally:
            worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_reextract_requires_confirmed_revised_scene_and_undo_restores_source(tmp_path, monkeypatch):
    """Adoption uses the explicitly re-confirmed range and retains old cited evidence."""
    old, new = '小雨握住门把推门。', '前缀。小雨关门。'

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            excerpt = '小雨关门。' if '小雨关门。' in str(messages) else old
            verb = '关门' if excerpt != old else '推门'
            output = {'shots': [{'id': 'door', 'excerpt': excerpt, 'designs': [{
                'id': 'light', 'card_type': 'direction.lighting',
                'fields': {'light_direction': {'state': 'fact', 'text': verb, 'excerpt': excerpt}}}]}]}
            if excerpt == old:
                output['missed_objects'] = [{'id': 'handle', 'name': '门把', 'kind': 'prop', 'excerpt': old}]
            return SimpleNamespace(content=json.dumps(output, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = old
            db.add(Provider(id='story-provider', name='openai', base_url='https://story.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='story-text', name='text', category='text', provider_id='story-provider'))

        async def data(response):
            assert response.status_code == 200, response.text
            return response.json()['data']

        async def run(path, task):
            worker = TaskWorker(sessions)
            try:
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
            finally:
                worker.text_pool.shutdown(wait=False)
            result = await data(await client.get(path + '/' + task['task_id']))
            assert result['status'] == 'succeeded', result
            return result

        base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = await data(await client.get(base))
        scene = await data(await client.post(base + '/sequences', json={'title': '场次', 'position': 0,
            'source_version': chapter['source_version'], 'span': {'start': 0, 'end': len(old)}}))
        scene_path = base + '/sequences/' + scene['id']
        path = scene_path + '/storyboards'
        command = {'request_id': 'first', 'text_model_id': 'story-text', 'mode': 'faithful'}
        first = await run(path, await data(await client.post(path, json=command)))
        canvas_id = first['canvas_id']
        canvas_path = '/api/v1/studio/generation-canvases/p1/' + canvas_id
        await data(await client.put(canvas_path, json={'request_id': 'storyboard:' + first['task_id'],
            'expected_revision': 0, 'document': first['candidate']['document']}))
        current = await data(await client.get(canvas_path))
        old_document = current['document']
        fixed_id = old_document['fixed_source']['card_id']
        design = next(card for card in old_document['cards'] if card['type'] == 'direction.lighting')
        design['fields']['light_direction'].update(text='手工布光', authorship='user')
        prop = next(card for card in old_document['cards'] if card['type'] == 'content.prop')
        prop_source = {'canvas_id': canvas_id, 'card_id': prop['id'], 'port_id': 'text', 'position': 0}
        old_document['cards'] += [{'id': 'manual-note', 'type': 'content.text', 'text': '人工新增'},
            {'id': 'manual-model', 'type': 'model.text', 'model_id': 'story-text',
             'input_bindings': [{'id': 'prop-use', 'input_port': 'text', 'source': prop_source}],
             'prompt': {'segments': [{'id': 'prefix', 'kind': 'text', 'text': '检查'},
                 {'id': 'quoted-prop', 'kind': 'reference', 'binding_id': 'prop-use'},
                 {'id': 'suffix', 'kind': 'text', 'text': '的状态'}]}}]
        old_document['edges'].append({'id': 'manual-link', 'source_card': prop['id'], 'source_port': 'text',
                                       'target_card': 'manual-model', 'target_port': 'text'})
        old_document['input_order']['manual-model'] = {'text': ['manual-link']}
        await data(await client.put(canvas_path, json={'request_id': 'manual-source-user',
            'expected_revision': current['revision'], 'document': old_document}))
        before = await data(await client.get(canvas_path))
        compiled_before = await data(await client.post(canvas_path + '/precheck', json={'card_id': 'manual-model'}))
        assert old in compiled_before['input']['text']

        await data(await client.patch('/api/v1/studio/chapters/ch1', json={'raw_text': new}))
        submit_path = scene_path + '/canvases/' + canvas_id + '/storyboards'
        reextract = {**command, 'request_id': 'reextract', 'adopt_current_source': True}
        unconfirmed = await client.post(submit_path, json=reextract)
        assert unconfirmed.status_code == 409, unconfirmed.text
        revised = await data(await client.get(base))
        await data(await client.put(scene_path, json={'title': scene['title'], 'position': scene['position'],
            'source_version': revised['source_version'], 'expected_version': scene['version'],
            'span': {'start': len('前缀。'), 'end': len(new)}}))
        result = await run(path, await data(await client.post(submit_path, json=reextract)))
        assert result['canvas_id'] == canvas_id and result['pending_application']
        candidate = result['candidate']['document']
        assert next(card for card in candidate['cards'] if card['id'] == candidate['fixed_source']['card_id'])['text'] == '小雨关门。'
        ordinary = await client.put(canvas_path, json={'request_id': 'forged-source',
            'expected_revision': before['revision'], 'document': candidate})
        assert ordinary.status_code == 422 and ordinary.json()['data']['code'] == 'FIXED_SOURCE_IMMUTABLE'
        app_path = path + '/' + result['task_id']
        diff = await data(await client.post(app_path + '/diff', json={'expected_revision': before['revision']}))
        assert diff['source_changed'] and any(item['id'] == design['id'] and item['manually_edited'] for item in diff['modified'])
        assert [(item['id'], item['lost_targets']) for item in diff['orphaned']] == [('manual-model', ['门把'])]
        conflict = await client.post(app_path + '/apply', json={'expected_revision': before['revision'] - 1})
        assert conflict.status_code == 409
        assert (await data(await client.get(canvas_path)))['revision'] == before['revision']

        applied = await data(await client.post(app_path + '/apply', json={'expected_revision': before['revision']}))
        document = applied['document']
        assert not applied['source_changed'] and document['fixed_source']['card_id'] != fixed_id
        assert next(card for card in document['cards'] if card['id'] == fixed_id)['text'] == old
        assert document['storyboard']['origins'][design['id']]['sources'][0]['card_id'] == fixed_id
        assert next(card for card in document['cards'] if card['id'] == design['id'])['fields']['light_direction']['text'] == '手工布光'
        assert any(card['id'] == 'manual-note' for card in document['cards'])
        compiled_after = await data(await client.post(canvas_path + '/precheck', json={'card_id': 'manual-model'}))
        assert compiled_after['input']['text'] == '检查门把的状态'
        undo = {'request_id': 'undo-source', 'expected_revision': applied['revision'],
                'direction': 'undo', 'document': before['document']}
        restored = await data(await client.post(app_path + '/restore', json=undo))
        assert restored['source_changed'] and restored['document'] == before['document']
        assert restored == await data(await client.get(canvas_path))
        compiled_restored = await data(await client.post(canvas_path + '/precheck', json={'card_id': 'manual-model'}))
        assert compiled_restored['input']['text'] == compiled_before['input']['text']
