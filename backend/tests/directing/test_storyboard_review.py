"""The scene task and both candidate application routes enforce continuity review."""

from tests.canvas_urls import append_canvas_path, canvas_url
import asyncio
from copy import deepcopy
import json
from types import SimpleNamespace

import httpx
import pytest

from app.models.llm import Model, Provider
from app.models.studio import Chapter
from app.models.task import Task
from app.services.directing.errors import DirectingOutputError
from app.services.directing.storyboard_prompt import write_video_prompt
from app.services.directing.storyboard_repair import repair_storyboard
from app.services.directing.storyboard_review import review_storyboard
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database
from tests.directing.test_storyboard_scope import read_data


@pytest.mark.parametrize(('operation', 'label'), [
    (review_storyboard, '审查响应'), (repair_storyboard, '修正响应'), (write_video_prompt, '提示词响应'),
])
def test_invalid_model_output_identifies_its_stage(operation, label):
    model = SimpleNamespace(invoke=lambda _messages: SimpleNamespace(content='invalid model output'))
    with pytest.raises(DirectingOutputError) as failure:
        operation(model, {'storyboard_draft': {'shots': []}})
    assert 'invalid model output' not in str(failure.value)
    assert failure.value.diagnostics.model_dump() == {
        'output': 'invalid model output', 'issues': [label + '格式无效：ValidationError'],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(('failure', 'kind'), [
    ('timeout', 'conflict'), ('invalid', 'conflict'), ('unknown_shot', 'insufficient_basis'), ('duplicate_shot', 'conflict'),
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
            assert 'repair_targets' not in args, '重试审查不得调用正文修正'
            if 'storyboard_draft' in args:
                reviews.append(args['storyboard_draft'])
                if len(reviews) == 1:
                    if failure == 'timeout':
                        raise httpx.ReadTimeout('controlled review timeout')
                    if failure == 'invalid':
                        return SimpleNamespace(content='unparseable review')
                    return SimpleNamespace(content=json.dumps({'issues': [{'kind': 'conflict', 'shot_ids': ['first', 'first'] if failure == 'duplicate_shot' else ['unknown'],
                        'requirements': '未知镜头', 'suggestion': '无效建议'}]}))
                result = {'issues': [{'kind': kind, 'shot_ids': ['first', 'second'],
                    'requirements': '静止与入场冲突，近景同时要求头、手和双脚；未交代从右手换到左手',
                    'suggestion': '保留原站位和右手，近景只拍手',
                    'repair_targets': [{'shot_id': 'first', 'design_id': 'continuity', 'field_id': 'change'}] if kind == 'conflict' else []}]}
            else:
                drafts.append(args)
                result = {'shots': [{'id': 'first', 'excerpt': '张三站在车旁不动。', 'designs': [{'id': 'continuity',
                    'card_type': 'direction.continuity', 'fields': {'change': {'state': 'proposal', 'text': '保持原地'}}}]},
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
        canvas_path = canvas_url('/api/v1/studio/generation-canvases/p1/') + task['canvas_id']
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
            assert basis['current_attempt']['title'] == '候选已保留，审查未完成'
            assert basis['user_issues'] == []
            if failure in ('unknown_shot', 'duplicate_shot', 'invalid'):
                assert any(entry.startswith('模型响应：') for entry in basis['current_attempt']['diagnostics'])
            if failure == 'invalid':
                assert first['error'] == '分镜审查返回无效，请重试审查'
                assert '模型响应：unparseable review' in basis['current_attempt']['diagnostics']
            if failure == 'duplicate_shot':
                async with sessions.begin() as db:
                    source_task = await db.get(Task, task['task_id'])
                    source_task.input_snapshot = {**source_task.input_snapshot,
                        'review_basis': {**source_task.input_snapshot['review_basis'], 'all': 'earlier-business-basis'}}
                basis = await read_data(client, 'GET', retry_path + '/basis')
                assert basis['review_basis_changed'] and basis['review_diff'] is not None
                refused = await client.post(retry_path, json={'request_id': 'unconfirmed-review'})
                assert refused.status_code == 409
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
    'repaired', 'still_conflict', 'recheck_timeout', 'repair_timeout', 'repair_invalid', 'out_of_scope', 'manual_protected',
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
                if outcome == 'repair_invalid':
                    return SimpleNamespace(content='unparseable repair')
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
                effective = args.get('effective_canvas', {}).get('cards', [])
                manual_conflict = any(card['type'] == 'direction.continuity' and card['change']['text'] == manual
                                      for card in effective)
                result = conflicts if review_enabled and (outcome != 'manual_protected' or manual_conflict) else {'issues': []}
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
        canvas_path = canvas_url('/api/v1/studio/generation-canvases/p1/') + task['canvas_id']
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
                target = path.removesuffix('/storyboards') + canvas_url('/canvases/') + task['canvas_id'] + '/storyboards'
                task = await read_data(client, 'POST', target, {'request_id': 'repair-reextract', 'text_model_id': 'repair-text'})
            result = await complete(task)
            assert len(repairs) == (0 if outcome == 'manual_protected' else 1)
            if outcome == 'repair_invalid':
                basis = await read_data(client, 'GET', path + '/' + task['task_id'] + '/retry/basis')
                assert result['error'] == '分镜修正返回无效，原草案已保留'
                assert basis['current_attempt']['diagnostics'] == [
                    '修正响应格式无效：ValidationError', '模型响应：unparseable repair',
                ]
            if outcome in ('recheck_timeout', 'repair_timeout', 'repair_invalid'):
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
            if outcome == 'still_conflict':
                assert result['repair_details']['status'] == 'applied'
                assert result['repair_details']['changes'][0]['after'] == corrected

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
                compiled = await read_data(client, 'GET', append_canvas_path(canvas_path, f'/cards/{first_model}/compile'))
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
            if outcome == 'manual_protected':
                task_path = path + '/' + task['task_id']
                choice = {'expected_revision': before['revision'], 'overwrite_card_ids': [continuity['id']]}
                preview = await read_data(client, 'POST', task_path + '/diff', choice)
                assert preview['continuity_review']['stale']
                rejected = await client.post(task_path + '/apply', json=choice)
                assert rejected.status_code == 409 and rejected.json()['data']['code'] == 'STORYBOARD_REVIEW_STALE'
                recheck = await read_data(client, 'POST', task_path + '/retry',
                                          {'request_id': 'review-overwrite', 'review_plan': choice})
                document = before['document']
                manual_card = next(item for item in document['cards'] if item['id'] == continuity['id'])
                manual_card['change']['text'] = '另一页面手动改变站位'
                await read_data(client, 'PUT', canvas_path, {'request_id': 'concurrent-manual-design',
                    'expected_revision': before['revision'], 'document': document})
                edited = await read_data(client, 'GET', canvas_path)
                checked = await complete(recheck)
                assert checked['review_state'] == 'passed' and checked['pending_application']
                checked_path = path + '/' + checked['task_id']
                choice['expected_revision'] = edited['revision']
                concurrent = await read_data(client, 'POST', checked_path + '/diff', choice)
                assert concurrent['continuity_review']['stale']
                rejected = await client.post(checked_path + '/apply', json=choice)
                assert rejected.status_code == 409 and rejected.json()['data']['code'] == 'STORYBOARD_REVIEW_STALE'
                assert await read_data(client, 'GET', canvas_path) == edited

                fresh = await read_data(client, 'POST', checked_path + '/retry',
                                        {'request_id': 'review-latest-overwrite', 'review_plan': choice})
                layout = edited['document']
                unrelated = next(group for group in layout['groups'] if continuity['id'] not in group['card_ids'])
                unrelated['name'] = '仅调整布局'
                arranged = await read_data(client, 'PUT', canvas_path, {'request_id': 'arrange-during-review',
                    'expected_revision': edited['revision'], 'document': layout})
                fresh_path = path + '/' + (await complete(fresh))['task_id']
                choice['expected_revision'] = arranged['revision']
                preserved = await read_data(client, 'POST', fresh_path + '/diff', {'expected_revision': arranged['revision']})
                assert preserved['continuity_review']['stale']
                current_plan = await read_data(client, 'POST', fresh_path + '/diff', choice)
                assert not current_plan['continuity_review']['stale']
                applied = await read_data(client, 'POST', fresh_path + '/apply', {**choice,
                    'confirmed_auto_stack_ids': [stack['id'] for stack in current_plan['automatic_stacks']]})
                assert next(group for group in applied['document']['groups'] if group['id'] == unrelated['id'])['name'] == '仅调整布局'
                assert next(item for item in applied['document']['cards'] if item['id'] == continuity['id'])['change']['text'] == proposed
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
        canvas_path = canvas_url('/api/v1/studio/generation-canvases/p1/') + task['canvas_id']
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
            undo_request = {'request_id': 'risk-undo', 'expected_revision': accepted['revision'],
                            'direction': 'undo', 'document': before['document']}
            undo = await read_data(client, 'POST', task_path + '/restore', undo_request)
            forged = await client.put(canvas_path, json={'request_id': 'forged',
                'expected_revision': undo['revision'], 'document': accepted['document']})
            assert forged.status_code == 409 and forged.json()['data']['code'] == 'STORYBOARD_REVIEW_REQUIRED'
            redo_request = {'request_id': 'risk-redo', 'expected_revision': undo['revision'],
                            'direction': 'redo', 'document': accepted['document']}
            altered = deepcopy(accepted['document'])
            next(card for card in altered['cards'] if card['type'] == 'direction.shot')['visible_result'].update(
                text='未经确认的另一份设计', authorship='user')
            rejected = await client.post(task_path + '/restore', json={**redo_request, 'document': altered})
            assert rejected.status_code == 422 and rejected.json()['data']['code'] == 'INVALID_STORYBOARD_RESTORE'
            assert await read_data(client, 'GET', canvas_path) == undo
            redone = await read_data(client, 'POST', task_path + '/restore', redo_request)
            assert redone['document'] == accepted['document']
            assert await read_data(client, 'POST', task_path + '/restore', undo_request) == undo
            assert await read_data(client, 'GET', canvas_path) == redone
            reextract = path.removesuffix('/storyboards') + canvas_url('/canvases/') + task['canvas_id'] + '/storyboards'
            following = await read_data(client, 'POST', reextract, {'request_id': 'same-design', 'text_model_id': 'risk-text'})
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            next_path = path + '/' + following['task_id']
            next_review = (await read_data(client, 'POST', next_path + '/diff',
                {'expected_revision': redone['revision']}))['continuity_review']
            assert not any(item['previously_accepted'] for item in next_review['conflicts'])
            changed = redone['document']
            shot = next(card for card in changed['cards'] if card['type'] == 'direction.shot')
            shot['visible_result'].update(text='张三离开车旁', authorship='user')
            edited = await read_data(client, 'PUT', canvas_path, {'request_id': 'changed',
                'expected_revision': redone['revision'], 'document': changed})
            observed = await read_data(client, 'GET', task_path)
            assert observed['review_state'] == 'accepted' and set(observed['accepted_conflict_ids']) == set(ids)
            stale = await client.post(next_path + '/apply', json={'expected_revision': edited['revision'],
                'review_token': next_review['token'], 'accepted_conflict_ids': ids})
            assert stale.status_code == 409 and stale.json()['data']['code'] == 'STORYBOARD_REVIEW_STALE'
        finally:
            worker.text_pool.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize('outcome', ['correct', 'unsafe', 'unsafe_association', 'choice', 'choice_timeout', 'choice_custom', 'notes_conflict', 'shared', 'shared_unsafe', 'shared_multiple'])
async def test_structural_retry_retains_draft_and_does_not_regenerate(tmp_path, monkeypatch, outcome):
    notes = '仅将四项共享站位排除镜头 01，保留其他范围和正文' if outcome == 'shared_multiple' else '保留等待表演，仅补齐张三的出镜关联'
    calls = []
    prompt_notes = []
    class ControlledModel:
        def __init__(self, **_kwargs):
            pass
        def invoke(self, messages):
            args = json.loads(messages[1].content)
            if 'prompt_unit' in args:
                from tests.directing.storyboard_prompt_fixture import video_prompt_response
                prompt_notes.append(args['correction_notes'])
                return video_prompt_response(messages)
            calls.append(messages)
            if 'storyboard_draft' in args:
                return SimpleNamespace(content='{"issues": []}')
            result = {'shots': [{'id': 'only', 'excerpt': '张三等待。', 'designs': [{
                'id': 'blocking', 'card_type': 'direction.blocking', 'object_id': 'zs',
                'fields': {'position': {'state': 'proposal', 'text': '保持原地'}}}]}],
                'missed_objects': [{'id': 'zs', 'name': '张三', 'kind': 'character', 'excerpt': '张三等待。'}]}
            if outcome.startswith('shared'):
                result['designs'] = result['shots'][0].pop('designs')
            if outcome == 'shared_multiple':
                result['shots'].append({'id': 'second', 'excerpt': '张三离开。', 'object_ids': ['zs']})
                result['designs'][0]['fields']['path'] = {
                    'state': 'proposal', 'text': '停留原地', 'scope': {'phase': 'video'}}
                result['designs'] *= 4
                result['designs'] = [{**design, 'id': f'blocking_{index}'} for index, design in enumerate(result['designs'])]
            if outcome in ('unsafe_association', 'shared_unsafe'):
                result.setdefault('designs', []).append({'id': 'unrelated', 'card_type': 'direction.camera', 'fields': {
                    'position': {'state': 'proposal', 'text': '保持机位', 'scope': {'shot_ids': ['only']}}}})
            if len(calls) == 2 and outcome.startswith('choice'):
                return SimpleNamespace(content=json.dumps({'structure_choices': [{'id': 'include',
                    'title': '补充镜头参与对象', 'impact': '张三参与镜头 only，保留原地等待设计',
                    'instruction': '把已登记的张三 zs 加入镜头 only 的 object_ids'}]}))
            if len(calls) >= 3 and outcome.startswith('notes_conflict'):
                return SimpleNamespace(content=json.dumps({'structure_choices': [], 'reason': '意见要求删改等待正文，请修改意见后重试'}))
            if len(calls) == 3 and outcome == 'choice_timeout':
                raise httpx.ReadTimeout('controlled structural correction timeout')
            if len(calls) >= 3:
                if outcome == 'shared_multiple':
                    for design in result['designs']:
                        for note in design['fields'].values():
                            note['scope'] = {**(note.get('scope') or {}), 'shot_ids': ['second']}
                else:
                    result['shots'][0]['object_ids'] = ['zs']
                if outcome in ('unsafe_association', 'shared_unsafe'):
                    result['designs'][-1]['fields']['position']['scope']['phase'] = 'video'
                if outcome == 'unsafe':
                    result['shots'][0]['designs'][0]['fields']['position']['text'] = '改成奔跑'
            return SimpleNamespace(content=json.dumps(result))
    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = '张三等待。张三离开。' if outcome == 'shared_multiple' else '张三等待。'
            db.add(Provider(id='structure-provider', name='openai', base_url='https://fixture.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='structure-text', name='text', category='text', provider_id='structure-provider'))
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = await read_data(client, 'GET', chapter)
        scene = await read_data(client, 'POST', chapter + '/sequences', {'title': '等待', 'position': 0,
            'source_version': source['source_version'], 'span': {'start': 0, 'end': 10 if outcome == 'shared_multiple' else 5}})
        path = chapter + '/sequences/' + scene['id'] + '/storyboards'
        task = await read_data(client, 'POST', path, {'request_id': 'structure', 'text_model_id': 'structure-text', 'pending_modality': 'video' if outcome == 'shared_multiple' else 'image'})
        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            first = await read_data(client, 'GET', path + '/' + task['task_id'])
            assert first['status'] == 'failed'
            basis = await read_data(client, 'GET', path + '/' + task['task_id'] + '/retry/basis')
            assert len(basis['user_issues']) == (4 if outcome == 'shared_multiple' else 1)
            assert basis['structure_only']
            assert basis['user_issues'][0]['title'] == ('镜头 01 · 共享站位与走位' if outcome.startswith('shared') else '镜头 01 · 对象关联')
            assert '张三' in basis['user_issues'][0]['explanation']
            assert 'blocking' not in basis['user_issues'][0]['explanation']
            assert 'blocking' in basis['structure_issues'][0] or outcome.startswith('choice')
            if outcome.startswith('choice'):
                assert basis['structure_options'][0]['id'] == 'include'
                refused = await client.post(path + '/' + task['task_id'] + '/retry', json={
                    'request_id': 'no-choice', 'basis_token': basis['basis']['token']})
                assert refused.status_code == 409
            retry = await read_data(client, 'POST', path + '/' + task['task_id'] + '/retry', {
                'request_id': 'fix-structure', 'basis_token': basis['basis']['token'],
                'structure_choice_id': 'include' if outcome.startswith('choice') and outcome != 'choice_custom' else None,
                'correction_notes': notes})
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            result = await read_data(client, 'GET', path + '/' + retry['task_id'])
            if outcome == 'choice_timeout':
                assert result['status'] == 'failed'
                again = await read_data(client, 'GET', path + '/' + retry['task_id'] + '/retry/basis')
                assert again['structure_only']
                assert again['current_attempt']['title'] == '本轮执行未完成'
                assert again['current_attempt']['diagnostics'] == [result['error']]
                assert len(again['user_issues']) == 1
                resumed = await read_data(client, 'POST', path + '/' + retry['task_id'] + '/retry', {
                    'request_id': 'resume-structure', 'basis_token': again['basis']['token'], 'structure_choice_id': 'include'})
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
                result = await read_data(client, 'GET', path + '/' + resumed['task_id'])
            if outcome.startswith('notes_conflict'):
                assert result['status'] == 'failed'
                next_basis = await read_data(client, 'GET', path + '/' + retry['task_id'] + '/retry/basis')
                assert next_basis['previous_correction_notes'] == notes
                assert next_basis['current_attempt']['reason'] == '模型认为：意见要求删改等待正文，请修改意见后重试'
                assert len(next_basis['user_issues']) == 1
                assert next_basis['history'][0]['task_id'] == task['task_id']
                repeated = await read_data(client, 'POST', path + '/' + retry['task_id'] + '/retry', {
                    'request_id': 'repeat-conflict', 'basis_token': next_basis['basis']['token'],
                    'correction_notes': notes})
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
                latest = await read_data(client, 'GET', path + '/' + repeated['task_id'] + '/retry/basis')
                assert len(latest['user_issues']) == 1
                assert latest['history'][0]['task_id'] == retry['task_id']
                assert latest['current_attempt']['reason'] == latest['history'][0]['reason']
                assert latest['current_attempt']['task_id'] != latest['history'][0]['task_id']
            elif outcome in ('unsafe', 'unsafe_association', 'shared_unsafe'):
                assert result['status'] == 'failed'
                assert len(calls) == 3
                assert ('未涉及错误的关联' if outcome in ('unsafe_association', 'shared_unsafe') else '结构纠错改变了') in result['error']
                next_basis = await read_data(client, 'GET', path + '/' + retry['task_id'] + '/retry/basis')
                assert next_basis['current_attempt']['title'] == '本轮修改未采用'
                assert len(next_basis['user_issues']) == 1
                assert all(issue['title'] != '上次纠错未采用' for issue in next_basis['user_issues'])
                assert next_basis['history'][0]['task_id'] == task['task_id']
                assert next_basis['structure_issues'][:len(basis['structure_issues'])] == basis['structure_issues']
            else:
                assert result['status'] == 'succeeded', result
                assert result['pending_application']
                assert len(calls) == (5 if outcome == 'choice_timeout' else 4)
            if outcome == 'shared_multiple':
                assert prompt_notes == [notes, notes]
                assert all(f'blocking_{index}' in calls[2][-1].content.split('"issues":')[1] for index in range(4))
            assert '继续修正保留草案' in calls[2][-1].content
            assert notes in calls[2][-1].content
            replay = await client.post(path + '/' + task['task_id'] + '/retry', json={
                'request_id': 'fix-structure', 'basis_token': basis['basis']['token'],
                'structure_choice_id': 'include' if outcome.startswith('choice') and outcome != 'choice_custom' else None,
                'correction_notes': '另一份意见'})
            assert replay.status_code == 409
        finally:
            worker.text_pool.shutdown(wait=False)
            if worker.client:
                await worker.client.aclose()


@pytest.mark.parametrize(('status', 'title'), [('succeeded', '本轮执行已完成'), ('cancelled', '本轮已取消')])
def test_attempt_outcome_preserves_terminal_task_status(status, title):
    from datetime import datetime
    from app.services.directing.storyboard_structure import structure_attempt
    task = SimpleNamespace(id='historical', created_at=datetime(2026, 11, 17), status=status,
        input_snapshot={}, result={}, error_message=None)
    assert structure_attempt(task)['title'] == title
