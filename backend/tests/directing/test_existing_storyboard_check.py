"""An explicit workbench check examines saved design, without reextracting it."""

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
@pytest.mark.parametrize('action', ['repair', 'accept'])
async def test_saved_check_recovers_and_applies_an_exact_correction(tmp_path, monkeypatch, action):
    original = '张三在车旁等待。'
    source = {'shots': [{'id': 'first', 'excerpt': original, 'designs': [
        {'id': 'camera', 'card_type': 'direction.camera', 'fields': {'viewpoint': {
            'state': 'proposal', 'text': '低机位绕行', 'excerpt': original}}}]}]}
    checks, extractions = [], []

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            args = json.loads(messages[1].content)
            if 'repair_targets' in args:
                result = {'edits': [{**args['repair_targets'][0], 'text': '固定低机位'}]}
            elif args.get('saved_canvas_check'):
                checks.append(args['storyboard_draft'])
                if len(checks) == 1:
                    raise httpx.ReadTimeout('controlled check failure')
                if 'recheck_shot_ids' in args:
                    result = {'issues': []}
                else:
                    camera = next(card for card in args['storyboard_draft']['cards'] if card['type'] == 'direction.camera')
                    result = {'issues': [{'kind': 'conflict', 'shot_ids': ['first'], 'requirements': '绕行会越轴',
                        'suggestion': '固定机位', 'repair_targets': [
                            {'shot_id': 'first', 'design_id': camera['id'], 'field_id': 'viewpoint'}]}]}
            elif 'storyboard_draft' in args:
                result = {'issues': []}
            else:
                extractions.append(args)
                result = source
            return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add(Provider(id='saved-provider', name='openai', base_url='https://fixture.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='saved-text', name='text', category='text', provider_id='saved-provider'))
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        book = await read_data(client, 'GET', chapter)
        scene = await read_data(client, 'POST', chapter + '/sequences', {'title': '已有画布', 'position': 0,
            'source_version': book['source_version'], 'span': {'start': 0, 'end': len(original)}})
        scene_path = chapter + '/sequences/' + scene['id']
        storyboards = scene_path + '/storyboards'
        original_task = await read_data(client, 'POST', storyboards, {'request_id': 'existing', 'text_model_id': 'saved-text'})
        canvas_path = '/api/v1/studio/generation-canvases/p1/' + original_task['canvas_id']
        checks_path = scene_path + '/canvases/' + original_task['canvas_id'] + '/continuity-check'
        worker = TaskWorker(sessions)
        try:
            async def work(item):
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
                return await read_data(client, 'GET', storyboards + '/' + item['task_id'])

            original_candidate = (await work(original_task))['candidate']
            await read_data(client, 'PUT', canvas_path, {'request_id': 'storyboard:' + original_task['task_id'],
                'expected_revision': original_candidate['base_revision'], 'document': original_candidate['document']})
            before = await read_data(client, 'GET', canvas_path)
            assert await read_data(client, 'GET', checks_path) is None
            request = {'request_id': 'check', 'expected_revision': before['revision']}
            check = await read_data(client, 'POST', checks_path, request)
            assert await read_data(client, 'POST', checks_path, request) == check
            blocked_delete = await client.delete(canvas_path, params={'expected_revision': before['revision']})
            assert blocked_delete.status_code == 409 and blocked_delete.json()['data']['code'] == 'STORYBOARD_BUSY'
            failed = await work(check)
            assert failed['status'] == 'failed' and failed['review_state'] == 'incomplete'
            assert (await read_data(client, 'GET', canvas_path)) == before
            retry = await read_data(client, 'POST', storyboards + '/' + check['task_id'] + '/retry',
                                    {'request_id': 'retry-check'})
            reviewed = await work(retry)
            assert checks[0] == checks[1] and len(extractions) == 1
            assert reviewed['review_state'] == 'conflict'
            assert (await read_data(client, 'GET', checks_path))['task_id'] == retry['task_id']
            assert (await read_data(client, 'GET', storyboards))[0]['task_id'] == original_task['task_id']

            document = before['document']
            document['groups'][0]['name'] = '调整后的布局'
            await read_data(client, 'PUT', canvas_path, {'request_id': 'only-layout',
                'expected_revision': before['revision'], 'document': document})
            before = await read_data(client, 'GET', canvas_path)
            retry_path = storyboards + '/' + retry['task_id']
            diff = await read_data(client, 'POST', retry_path + '/diff', {'expected_revision': before['revision']})
            proof = diff['continuity_review']
            [conflict] = proof['conflicts']
            assert not proof['stale'] and conflict['can_repair']
            if action == 'repair':
                repair = await read_data(client, 'POST', retry_path + '/retry', {
                    'request_id': 'fix-saved', 'targeted_repair': {'conflict_id': conflict['id'],
                        'review_token': proof['token'], 'expected_revision': before['revision']}})
                repaired = await work(repair)
                assert repaired['review_state'] == 'passed'
                assert (await read_data(client, 'GET', canvas_path)) == before
                repaired_path = storyboards + '/' + repair['task_id']
                preview = await read_data(client, 'POST', repaired_path + '/diff', {'expected_revision': before['revision']})
                assert len(preview['modified']) == 1
                applied = await read_data(client, 'POST', repaired_path + '/apply', {'expected_revision': before['revision'],
                    'review_token': preview['continuity_review']['token']})
            else:
                repaired_path = retry_path
                applied = await read_data(client, 'POST', retry_path + '/apply', {'expected_revision': before['revision'],
                    'review_token': proof['token'], 'accepted_conflict_ids': [conflict['id']]})
                assert (await read_data(client, 'GET', checks_path))['review_state'] == 'accepted'
            assert applied['document']['storyboard']['task_id'] == original_task['task_id']
            assert applied['document']['groups'] == before['document']['groups']
            assert next(card for card in applied['document']['cards'] if card['type'] == 'direction.camera')['fields']['viewpoint']['text'] == (
                '固定低机位' if action == 'repair' else '低机位绕行')
            undone = await read_data(client, 'POST', repaired_path + '/restore', {'request_id': 'undo-saved',
                'expected_revision': applied['revision'], 'direction': 'undo', 'document': before['document']})
            assert undone['document'] == before['document']
            assert (await read_data(client, 'GET', checks_path))['review_state'] == ('stale' if action == 'repair' else 'conflict')

            stale = await read_data(client, 'POST', checks_path, {'request_id': 'stale-check', 'expected_revision': undone['revision']})
            manual = undone['document']
            camera = next(card for card in manual['cards'] if card['type'] == 'direction.camera')
            camera['fields']['viewpoint'].update(text='人工改为高机位', authorship='user')
            await read_data(client, 'PUT', canvas_path, {'request_id': 'concurrent',
                'expected_revision': undone['revision'], 'document': manual})
            checked = await work(stale)
            assert checked['review_state'] == 'stale'
            latest = await read_data(client, 'GET', canvas_path)
            stale_path = storyboards + '/' + stale['task_id']
            diff = await read_data(client, 'POST', stale_path + '/diff', {'expected_revision': latest['revision']})
            proof = diff['continuity_review']
            stale_apply = await client.post(stale_path + '/apply', json={'expected_revision': latest['revision'],
                'review_token': proof['token'], 'accepted_conflict_ids': [choice['id'] for choice in proof['conflicts']]})
            assert stale_apply.status_code == 409 and stale_apply.json()['data']['code'] == 'STORYBOARD_REVIEW_STALE'
            forged = latest['document']
            forged['storyboard']['continuity_check_task_id'] = stale['task_id']
            ordinary_save = await client.put(canvas_path, json={'request_id': 'forged-check-application',
                'expected_revision': latest['revision'], 'document': forged})
            assert ordinary_save.status_code == 409
            assert len(extractions) == 1
        finally:
            worker.text_pool.shutdown(wait=False)
