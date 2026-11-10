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


@pytest.mark.asyncio
@pytest.mark.parametrize('outcome', [
    'repaired', 'still_conflict', 'recheck_timeout', 'repair_timeout', 'out_of_scope', 'manual_protected',
])
async def test_targeted_repair_preserves_evidence_and_never_repeats(tmp_path, monkeypatch, outcome):
    first, second, third = '张三站在车旁。', '他低头看手。', '街角灯亮了。'
    original = first + second + third
    repairs, rechecks = [], []
    review_enabled = outcome != 'manual_protected'
    conflicts = {'issues': [{'kind': 'conflict', 'shot_ids': ['first'], 'requirements': '入场与静止冲突',
        'suggestion': '保持原地', 'repair_targets': [
            {'shot_id': 'first', 'design_id': 'continuity', 'field_id': 'change'}]}]}
    proposed = '张三从画外入场'
    corrected = '张三留在车旁，镜头切近'
    manual = '按人工设计保持车旁站位'
    draft = {'shots': [
        {'id': 'first', 'excerpt': first, 'designs': [{'id': 'continuity', 'card_type': 'direction.continuity', 'fields': {
            'before': {'state': 'fact', 'text': '站在车旁', 'excerpt': first},
            'change': {'state': 'proposal', 'text': proposed, 'excerpt': first}}}]},
        {'id': 'second', 'excerpt': second},
        {'id': 'third', 'excerpt': third, 'designs': [{'id': 'light', 'card_type': 'direction.lighting', 'fields': {
            'light_direction': {'state': 'proposal', 'text': '保留街角原有侧光'}}}]},
    ]}
    if outcome == 'out_of_scope':
        conflicts['issues'][0]['repair_targets'].append({'shot_id': 'first', 'design_id': 'continuity', 'field_id': 'before'})

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            args = json.loads(messages[1].content)
            if 'repair_targets' in args:
                repairs.append(args)
                if outcome == 'repair_timeout':
                    raise httpx.ReadTimeout('controlled repair failure')
                target = conflicts['issues'][0]['repair_targets'][0]
                result = {'edits': [{**target, 'text': corrected if len(repairs) == 1 else '保留车旁站位，镜头停稳'}]}
                if outcome == 'out_of_scope':
                    assert all(item['field_id'] != 'before' for item in args['repair_targets'])
                    result['edits'].append({**target, 'field_id': 'before', 'text': '不在车旁'})
                    result['edits'].append({'shot_id': 'third', 'design_id': 'light', 'field_id': 'light_direction', 'text': '改成顶光'})
            elif 'recheck_shot_ids' in args:
                rechecks.append(args)
                if outcome == 'recheck_timeout' and len(rechecks) == 1:
                    raise httpx.ReadTimeout('controlled recheck failure')
                result = conflicts if outcome == 'still_conflict' and len(repairs) == 1 else {'issues': []}
            elif 'storyboard_draft' in args:
                result = conflicts if review_enabled else {'issues': []}
            else:
                result = draft
            return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='repair-provider', name='openai', base_url='https://fixture.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='repair-text', name='text', category='text', provider_id='repair-provider'))
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = await read_data(client, 'GET', chapter)
        scene = await read_data(client, 'POST', chapter + '/sequences', {'title': '定向修正', 'position': 0,
            'source_version': source['source_version'], 'span': {'start': 0, 'end': len(original)}})
        path = chapter + '/sequences/' + scene['id'] + '/storyboards'
        task = await read_data(client, 'POST', path, {'request_id': 'repair', 'text_model_id': 'repair-text'})
        canvas_path = '/api/v1/studio/generation-canvases/p1/' + task['canvas_id']
        before = await read_data(client, 'GET', canvas_path)
        worker = TaskWorker(sessions)
        try:
            async def complete(item):
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
                return await read_data(client, 'GET', path + '/' + item['task_id'])

            if outcome == 'manual_protected':
                initial = (await complete(task))['candidate']
                applied = await read_data(client, 'PUT', canvas_path, {'request_id': 'storyboard:' + task['task_id'],
                    'expected_revision': initial['base_revision'], 'document': initial['document']})
                current = (await read_data(client, 'GET', canvas_path))['document']
                card = next(card for card in current['cards'] if card['type'] == 'direction.continuity')
                card['change'].update(text=manual, authorship='user')
                await read_data(client, 'PUT', canvas_path, {'request_id': 'manual-design',
                    'expected_revision': applied['revision'], 'document': current})
                before = await read_data(client, 'GET', canvas_path)
                assert before['document']['storyboard']['origins'][card['id']]['manually_edited']
                review_enabled = True
                target = path.removesuffix('/storyboards') + '/canvases/' + task['canvas_id'] + '/storyboards'
                task = await read_data(client, 'POST', target, {'request_id': 'repair-reextract', 'text_model_id': 'repair-text'})
            result = await complete(task)
            assert len(repairs) == (0 if outcome == 'manual_protected' else 1)
            if outcome in ('recheck_timeout', 'repair_timeout'):
                assert result['status'] == 'failed' and result['review_state'] == 'incomplete'
                assert (await read_data(client, 'GET', canvas_path)) == before
                task = await read_data(client, 'POST', path + '/' + task['task_id'] + '/retry', {'request_id': 'recheck-only'})
                result = await complete(task)
                assert len(repairs) == 1
                if outcome == 'recheck_timeout':
                    assert rechecks[0] == rechecks[1]
                else:
                    assert len(rechecks) == 1 and not rechecks[0]['recheck_shot_ids']
            assert result['status'] == 'succeeded', result
            applied_repair = outcome in ('repaired', 'still_conflict', 'recheck_timeout')
            if applied_repair:
                assert rechecks[0]['recheck_shot_ids'] == ['first', 'second']
            assert result['review_state'] == ('passed' if outcome in ('repaired', 'recheck_timeout') else 'conflict')
            cards = result['candidate']['document']['cards']
            continuity = next(card for card in cards if card['type'] == 'direction.continuity')
            assert continuity['before']['text'] == '站在车旁' and continuity['before']['source_locator'] == first
            assert continuity['change']['text'] == (corrected if applied_repair else proposed)
            assert continuity['change']['source_locator'] == first
            lighting = next(card for card in cards if card['type'] == 'direction.lighting')
            assert lighting['fields']['light_direction']['text'] == '保留街角原有侧光'
            assert await read_data(client, 'GET', canvas_path) == before
            if outcome == 'repaired':
                candidate = result['candidate']
                await read_data(client, 'PUT', canvas_path, {'request_id': 'storyboard:' + task['task_id'],
                    'expected_revision': candidate['base_revision'], 'document': candidate['document']})
                first_model = candidate['document']['storyboard']['shots'][0]['model_card_ids'][0]
                compiled = await read_data(client, 'GET', f'{canvas_path}/cards/{first_model}/compile')
                assert corrected in compiled['text'] and proposed not in compiled['text']
            if outcome == 'still_conflict':
                task_path = path + '/' + task['task_id']
                preview = await read_data(client, 'POST', task_path + '/diff', {'expected_revision': before['revision']})
                evidence = preview['continuity_review']
                [conflict] = evidence['conflicts']
                assert conflict['can_repair']
                command = {'request_id': 'user-targeted', 'targeted_repair': {'conflict_id': conflict['id'],
                    'review_token': evidence['token'], 'expected_revision': before['revision']}}
                repaired_task = await read_data(client, 'POST', task_path + '/retry', command)
                assert await read_data(client, 'POST', task_path + '/retry', command) == repaired_task
                repaired = await complete(repaired_task)
                assert repaired['review_state'] == 'passed' and repaired['pending_application']
                assert len(repairs) == 2
                card = next(item for item in repaired['candidate']['document']['cards'] if item['type'] == 'direction.continuity')
                assert card['change']['text'] == '保留车旁站位，镜头停稳'
                assert await read_data(client, 'GET', canvas_path) == before
        finally:
            worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
async def test_risk_acceptance_requires_exact_conflicts_and_real_restore(tmp_path, monkeypatch):
    first, second = '张三站在车旁。', '他低头看手。'
    original = first + second
    draft = {'shots': [{'id': 'first', 'excerpt': first}, {'id': 'second', 'excerpt': second}]}
    report = {'issues': [
        {'kind': 'conflict', 'shot_ids': ['first'], 'requirements': '入场和静止冲突', 'suggestion': '保持站位'},
        {'kind': 'conflict', 'shot_ids': ['second'], 'requirements': '未说明换手', 'suggestion': '保持持物手'},
        {'kind': 'insufficient_basis', 'shot_ids': ['second'], 'requirements': '摄影方向未知', 'suggestion': '核对前镜'},
    ]}

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            args = json.loads(messages[1].content)
            return SimpleNamespace(content=json.dumps(report if 'storyboard_draft' in args else draft, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='risk-provider', name='openai', base_url='https://fixture.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='risk-text', name='text', category='text', provider_id='risk-provider'))
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = await read_data(client, 'GET', chapter)
        scene = await read_data(client, 'POST', chapter + '/sequences', {'title': '风险选择', 'position': 0,
            'source_version': source['source_version'], 'span': {'start': 0, 'end': len(original)}})
        path = chapter + '/sequences/' + scene['id'] + '/storyboards'
        task = await read_data(client, 'POST', path, {'request_id': 'risk', 'text_model_id': 'risk-text'})
        task_path = path + '/' + task['task_id']
        canvas_path = '/api/v1/studio/generation-canvases/p1/' + task['canvas_id']
        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            before = await read_data(client, 'GET', canvas_path)
            diff = await read_data(client, 'POST', task_path + '/diff', {'expected_revision': before['revision']})
            review = diff['continuity_review']
            ids = [item['id'] for item in review['conflicts']]
            assert len(set(ids)) == 2
            arranged = {**before['document'], 'groups': [{'id': 'layout-only', 'name': '布局',
                'card_ids': [before['document']['fixed_source']['card_id']]}]}
            await read_data(client, 'PUT', canvas_path, {'request_id': 'arrange',
                'expected_revision': before['revision'], 'document': arranged})
            before = await read_data(client, 'GET', canvas_path)
            after_layout = await read_data(client, 'POST', task_path + '/diff', {'expected_revision': before['revision']})
            assert not after_layout['continuity_review']['stale']
            assert after_layout['continuity_review']['token'] == review['token']
            choice = {'expected_revision': before['revision'], 'review_token': review['token'],
                      'accepted_conflict_ids': ids}
            rejected = await client.post(task_path + '/apply', json={**choice, 'accepted_conflict_ids': ids[:1]})
            assert rejected.status_code == 409 and rejected.json()['data']['code'] == 'STORYBOARD_REVIEW_REQUIRED'
            accepted = await read_data(client, 'POST', task_path + '/apply', choice)
            assert await read_data(client, 'POST', task_path + '/apply', choice) == accepted
            observed = await read_data(client, 'GET', task_path)
            assert observed['review_state'] == 'accepted' and set(observed['accepted_conflict_ids']) == set(ids)
            undo = await read_data(client, 'POST', task_path + '/restore', {'request_id': 'risk-undo',
                'expected_revision': accepted['revision'], 'direction': 'undo', 'document': before['document']})
            forged = await client.put(canvas_path, json={'request_id': 'forged',
                'expected_revision': undo['revision'], 'document': accepted['document']})
            assert forged.status_code == 409 and forged.json()['data']['code'] == 'STORYBOARD_REVIEW_REQUIRED'
            redone = await read_data(client, 'POST', task_path + '/restore', {'request_id': 'risk-redo',
                'expected_revision': undo['revision'], 'direction': 'redo', 'document': accepted['document']})
            assert redone['document'] == accepted['document']
            reextract = path.removesuffix('/storyboards') + '/canvases/' + task['canvas_id'] + '/storyboards'
            following = await read_data(client, 'POST', reextract, {'request_id': 'same-design', 'text_model_id': 'risk-text'})
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            next_path = path + '/' + following['task_id']
            next_review = (await read_data(client, 'POST', next_path + '/diff',
                {'expected_revision': redone['revision']}))['continuity_review']
            assert {item['id'] for item in next_review['conflicts'] if item['previously_accepted']} == set(ids)
            changed = redone['document']
            shot = next(card for card in changed['cards'] if card['type'] == 'direction.shot')
            shot['visible_result'].update(text='张三离开车旁', authorship='user')
            edited = await read_data(client, 'PUT', canvas_path, {'request_id': 'changed',
                'expected_revision': redone['revision'], 'document': changed})
            observed = await read_data(client, 'GET', task_path)
            assert observed['review_state'] == 'stale' and not observed['accepted_conflict_ids']
            stale = await client.post(next_path + '/apply', json={'expected_revision': edited['revision'],
                'review_token': next_review['token'], 'accepted_conflict_ids': ids})
            assert stale.status_code == 409 and stale.json()['data']['code'] == 'STORYBOARD_REVIEW_STALE'
        finally:
            worker.text_pool.shutdown(wait=False)
