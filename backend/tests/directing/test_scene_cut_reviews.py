"""当前场次版本独立保存采用片段，不改变素材事实或自动紧排。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.services.directing.store import DirectingStore
from tests.directing.samples import SOURCE, design_sample, plan_sample
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database, frozen, output


@pytest.mark.asyncio
async def test_scene_cut_review_freezes_basis_and_rechecks_actual_composition(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            design = await frozen(store, path.rsplit('/', 1)[1], 'design', design_sample())
            plan = await frozen(store, design.sequence_id, 'plan', plan_sample(design.id))
            prompt = await frozen(store, design.sequence_id, 'prompt', {'plan_revision_id': plan.id, 'unit_id': 'u1',
                'format_version': 'fixture', 'text': '旧素材', 'sources': [SOURCE], 'decisions': []})
            await output(db, prompt.id)
            take = await store.register_take(prompt_revision_id=prompt.id, task_id='task1', output_ordinal=0)
            take_id = take.id
        original = (await client.get(path)).json()['data']['takes']
        created = await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '独立采用'})
        version = created.json()['data']
        assert version['content']['timeline'] == {'items': []}
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design'] = design_sample()
        content['units'] = [{'id': 'unit', 'ratio': '16:9', 'coverage': [{'id': 'action', 'shot_id': 's1', 'beat_ids': [], 'event_ids': [], 'action_scope': '当前动作'}]}]
        content['timeline']['items'] = [{'kind': 'media', 'id': 'clip', 'take_kind': 'production_plan', 'take_id': take_id, 'file_id': 'video1',
            'media_range': {'source_in_ms': 0, 'source_out_ms': 1000}, 'timeline_start_ms': 0}]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        saved = saved.json()['data']
        review_path = detail + '/cut-reviews'
        request = {'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'decision': {
            'verdict': 'pass', 'overall': '画面叙事成立', 'established': '动作与反应连贯', 'coverage_status': 'verified',
            'coverage_notes': '已逐项核对当前计划与实际画面', 'issues': [], 'sound_status': 'pending_postproduction', 'sound_notes': '对白待后期'}}
        response = await client.post(review_path, json=request)
        assert response.status_code == 200, response.text
        review = response.json()['data']
        assert review['matches_current'] is True
        assert review['content'] == saved['content']
        assert review['decision']['sound_status'] == 'pending_postproduction'
        assert (await client.post(review_path, json=request)).json()['data'] == review
        assert len((await client.get(review_path)).json()['data']) == 1
        changed = deepcopy(saved['content'])
        changed['output_aspect_ratio'] = '9:16'
        changed['timeline']['items'][0]['fit'] = 'cover'
        changed_response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': changed})
        assert changed_response.status_code == 200, changed_response.text
        current = changed_response.json()['data']
        rows = (await client.get(review_path)).json()['data']
        assert rows[0] == {**review, 'matches_current': False}
        assert (await client.post(review_path, json=request)).json()['data'] == rows[0]
        conflicting = deepcopy(request)
        conflicting['decision']['overall'] = '同一请求不能改写历史结论'
        assert (await client.post(review_path, json=conflicting)).status_code == 409
        stale = {**request, 'request_id': str(uuid4())}
        assert (await client.post(review_path, json=stale)).status_code == 409
        for changes in [{'coverage_status': 'unknown'}, {'sound_status': 'reviewed', 'sound_notes': ''},
                {'issues': [{'id': 'issue', 'severity': 'required', 'observation': '必须修复', 'acceptance': '修复动作', 'clip_ids': ['clip']}]},
                {'verdict': 'revise', 'issues': [{'id': 'issue', 'severity': 'optional', 'observation': '局部建议', 'acceptance': '检查', 'clip_ids': ['missing']}]}]:
            invalid = {**request, 'request_id': str(uuid4()), 'expected_revision': current['revision'], 'decision': {**request['decision'], **changes}}
            rejected = await client.post(review_path, json=invalid)
            assert rejected.status_code == 422, rejected.text
        assert len((await client.get(review_path)).json()['data']) == 1
        restored = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': saved['content']})
        assert restored.status_code == 200, restored.text
        assert (await client.get(review_path)).json()['data'][0]['matches_current'] is True
        unrelated = restored.json()['data']
        unrelated_content = deepcopy(unrelated['content'])
        unrelated_content['units'][0]['instruction'] = '后续生成指令不改变当前实际剪辑'
        unrelated_response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': unrelated['revision'], 'content': unrelated_content})
        assert unrelated_response.status_code == 200, unrelated_response.text
        assert (await client.get(review_path)).json()['data'][0]['matches_current'] is True
        current = unrelated_response.json()['data']
        interval = deepcopy(current['content'])
        interval['timeline']['items'][0]['media_range']['source_out_ms'] = 800
        interval_response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': interval})
        assert interval_response.status_code == 200, interval_response.text
        assert (await client.get(review_path)).json()['data'][0]['matches_current'] is False
        current = interval_response.json()['data']
        planned = deepcopy(current['content'])
        planned['timeline']['items'].append({'kind': 'planned', 'id': 'placeholder', 'shot_id': 's1', 'estimated_duration_ms': 1000, 'timeline_start_ms': 2000})
        planned_response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': planned})
        assert planned_response.status_code == 200, planned_response.text
        with_placeholder = {**request, 'request_id': str(uuid4()), 'expected_revision': planned_response.json()['data']['revision']}
        assert (await client.post(review_path, json=with_placeholder)).status_code == 422
        with_placeholder['decision'] = {**request['decision'], 'verdict': 'revise'}
        assert (await client.post(review_path, json=with_placeholder)).status_code == 422
        with_placeholder['decision']['coverage_status'] = 'gaps'
        with_placeholder['decision']['coverage_notes'] = '仍有待拍占位'
        assert (await client.post(review_path, json=with_placeholder)).status_code == 200
        assert (await client.get(review_path)).json()['data'][0] == {**review, 'matches_current': False}
        assert (await client.get(path)).json()['data']['takes'] == original
