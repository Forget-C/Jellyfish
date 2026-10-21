"""整份另存保留点击内容，不预先保存原版本或复制任务。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.models.llm import Model, Provider
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database
from tests.directing.samples import complete_shot_scope_sample


@pytest.mark.asyncio
async def test_copy_keeps_unsaved_content_and_original_revision_with_idempotent_receipt(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        original = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '原版本'})).json()['data']
        detail = path + '/versions/' + original['id']
        content = deepcopy(original['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': 'unit', 'ratio': '16:9', 'instruction': '未保存正文', 'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '转身'}]}]
        content['timeline']['items'] = [{'kind': 'planned', 'id': 'planned', 'shot_id': 'shot', 'timeline_start_ms': 500, 'estimated_duration_ms': 2000}]
        content['output_aspect_ratio'] = '9:16'
        readiness = await client.get(detail + '/copy-readiness')
        assert readiness.status_code == 200, readiness.text
        assert readiness.json()['data'] == {'ready': True, 'blockers': []}
        request = {'request_id': str(uuid4()), 'expected_revision': original['revision'], 'title': '副本', 'content': content}
        response = await client.post(detail + '/copy', json=request)
        assert response.status_code == 200, response.text
        copied = response.json()['data']
        assert copied['id'] != original['id'] and copied['copied_from_version_id'] == original['id']
        assert copied['revision'] == 1 and copied['content']['units'][0]['instruction'] == '未保存正文'
        assert copied['content']['basis'] == original['content']['basis']
        assert copied['content']['timeline'] == content['timeline']
        assert copied['content']['output_aspect_ratio'] == '9:16'
        assert (await client.get(detail)).json()['data'] == original
        assert (await client.post(detail + '/copy', json=request)).json()['data'] == copied
        assert len((await client.get(path + '/versions')).json()['data']) == 2
        assert (await client.post(detail + '/copy', json={**request, 'title': '另一授权'})).status_code == 409
        assert (await client.post(detail + '/copy', json={**request, 'request_id': str(uuid4()), 'expected_revision': 99})).status_code == 409
        changed = deepcopy(copied['content'])
        changed['output_aspect_ratio'] = '1:1'
        saved = await client.put(path + '/versions/' + copied['id'], json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': changed})
        assert saved.status_code == 200, saved.text
        assert (await client.get(detail)).json()['data'] == original


@pytest.mark.asyncio
@pytest.mark.parametrize('terminal', ['failed', 'cancelled', 'succeeded'])
async def test_copy_rechecks_tasks_after_readiness_and_accepts_failed_terminal(tmp_path, terminal):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='copy-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='copy-text', name='gpt-test', category='text', provider_id='copy-provider', params={}),
                        Model(id='copy-video', name='test-video-model', category='video', provider_id='copy-provider', params={})])
        path = await sequence_path(client)
        original = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '原版本'})).json()['data']
        detail = path + '/versions/' + original['id']
        content = deepcopy(original['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': 'unit', 'ratio': '16:9', 'model_id': 'copy-video', 'duration_ms': 5000, 'instruction': '转身', 'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '转身'}]}]
        complete_shot_scope_sample(content, '转身')
        basis = await client.post(detail + '/units/unit/instruction-basis/confirm', json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert basis.status_code == 200, basis.text
        content['units'][0]['instruction_basis_id'] = basis.json()['data']['basis_id']
        assert (await client.get(detail + '/copy-readiness')).json()['data']['ready']
        task = await client.post(detail + '/units/unit/instruction-checks', json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content, 'model_id': 'copy-text'})
        assert task.status_code == 200, task.text
        task_id = task.json()['data']['task_id']
        request = {'request_id': str(uuid4()), 'expected_revision': 1, 'title': '副本', 'content': content}
        assert (await client.post(detail + '/copy', json=request)).status_code == 409
        readiness = (await client.get(detail + '/copy-readiness')).json()['data']
        assert not readiness['ready'] and readiness['blockers'][0]['task_id'] == task_id
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='copy-fixture')
            if terminal == 'cancelled':
                await service.request_cancel(task_id, reason='用户取消检查')
        assert not (await client.get(detail + '/copy-readiness')).json()['data']['ready']
        assert (await client.post(detail + '/copy', json=request)).status_code == 409
        result = {'unit_id': 'unit', 'rows': [{'role': role, 'occurrence_id': 'coverage', 'verdict': 'pass', 'rationale': '动作明确', 'findings': []} for role in ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']],
                  'destinations': [{'owner': 'coverage:coverage', 'field': 'action_scope', 'coverage_item_ids': ['coverage'],
                                    'destination': 'instruction', 'instruction_excerpt': '转身', 'rationale': '正文直接表达'}]}
        async with sessions.begin() as db:
            await TaskService(db).finish(task_id, error='外部检查失败' if terminal == 'failed' else None,
                cancelled=terminal == 'cancelled', result=result if terminal == 'succeeded' else None)
        if terminal == 'succeeded':
            confirmed = await client.post(detail + '/units/unit/instruction-checks/' + task_id + '/confirm', json={'content': content})
            assert confirmed.status_code == 200, confirmed.text
            content['units'][0]['instruction_check_task_id'] = task_id
        copied = await client.post(detail + '/copy', json=request)
        assert copied.status_code == 200, copied.text
        target = copied.json()['data']
        assert target['content']['units'][0]['instruction_basis_id'] == content['units'][0]['instruction_basis_id']
        copied_unit = path + '/versions/' + target['id'] + '/units/unit'
        rows = (await client.get(copied_unit + '/instruction-checks')).json()['data']
        if terminal == 'succeeded':
            assert len(rows) == 1 and rows[0]['task_id'] == task_id
            assert rows[0]['origin_version_id'] == original['id']
            compared = await client.post(copied_unit + '/instruction-checks/' + task_id + '/compare', json={'content': target['content']})
            assert compared.status_code == 200, compared.text
            assert compared.json()['data']['confirmed']
            prepared = await client.post(copied_unit + '/video/prepare', json={'expected_revision': 1})
            assert prepared.status_code == 200, prepared.text
            next_copy = await client.post(path + '/versions/' + target['id'] + '/copy', json={
                'request_id': str(uuid4()), 'expected_revision': 1, 'title': '副本的副本', 'content': target['content']})
            assert next_copy.status_code == 200, next_copy.text
            next_target = next_copy.json()['data']
            next_unit = path + '/versions/' + next_target['id'] + '/units/unit'
            inherited = (await client.get(next_unit + '/instruction-checks')).json()['data']
            assert len(inherited) == 1 and inherited[0]['origin_version_id'] == original['id']
            assert (await client.post(next_unit + '/video/prepare', json={'expected_revision': 1})).status_code == 200
            unrelated = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '独立版本'})).json()['data']
            forged = await client.put(path + '/versions/' + unrelated['id'], json={
                'request_id': str(uuid4()), 'expected_revision': 1, 'content': target['content']})
            assert forged.status_code == 422, forged.text
        else:
            assert rows == []
        state = await client.post(copied_unit + '/instruction-basis', json={'content': target['content']})
        assert state.status_code == 200, state.text
        assert state.json()['data']['status'] == 'current'
        assert (await client.get(detail)).json()['data'] == original


@pytest.mark.asyncio
async def test_copy_freezes_review_links_without_following_later_origin_reviews(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        original = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '原审片版本'})).json()['data']
        detail = path + '/versions/' + original['id']
        content = deepcopy(original['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['timeline']['items'] = [{'kind': 'planned', 'id': 'planned', 'shot_id': 'shot', 'timeline_start_ms': 0, 'estimated_duration_ms': 2000}]
        saved = (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})).json()['data']
        decision = {'verdict': 'revise', 'overall': '待拍缺口', 'established': '时间结构已核对', 'coverage_status': 'gaps',
            'coverage_notes': '占位待拍', 'issues': [], 'sound_status': 'pending_postproduction', 'sound_notes': '待后期'}
        review = await client.post(detail + '/cut-reviews', json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'decision': decision})
        assert review.status_code == 200, review.text
        review = review.json()['data']
        copied = await client.post(detail + '/copy', json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'title': '副本', 'content': saved['content']})
        assert copied.status_code == 200, copied.text
        target = copied.json()['data']
        copied_path = path + '/versions/' + target['id']
        assert (await client.get(copied_path + '/cut-reviews')).json()['data'] == [review]
        later = await client.post(detail + '/cut-reviews', json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'decision': {**decision, 'overall': '原版本后来重新审片'}})
        assert later.status_code == 200, later.text
        assert (await client.get(copied_path + '/cut-reviews')).json()['data'] == [review]
        delivery = await client.post(copied_path + '/deliveries', json={'request_id': str(uuid4()), 'expected_revision': 1})
        assert delivery.status_code == 200, delivery.text
        assert delivery.json()['data']['review_id'] == review['id']
        changed = deepcopy(target['content'])
        changed['output_aspect_ratio'] = '9:16'
        assert (await client.put(copied_path, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': changed})).status_code == 200
        assert (await client.get(copied_path + '/cut-reviews')).json()['data'] == [{**review, 'matches_current': False}]
        assert all(row['matches_current'] for row in (await client.get(detail + '/cut-reviews')).json()['data'])
