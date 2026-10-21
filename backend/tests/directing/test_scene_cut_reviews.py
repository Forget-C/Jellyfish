"""当前场次版本独立保存采用片段，不改变素材事实或自动紧排。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.services.directing.store import DirectingStore
from tests.directing.samples import SOURCE, design_sample, editable_design_sample, plan_sample
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
        content['design'] = editable_design_sample()
        content['units'] = [{'id': 'unit', 'ratio': '16:9', 'coverage': [{'id': 'action', 'shot_id': 's1', 'beat_ids': [], 'event_ids': [], 'action_scope': '当前动作'}]}]
        content['timeline']['items'] = [{'kind': 'media', 'id': 'clip', 'take_kind': 'production_plan', 'take_id': take_id, 'file_id': 'video1',
            'media_range': {'source_in_ms': 0, 'source_out_ms': 1000}, 'timeline_start_ms': 0}]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        saved = saved.json()['data']
        from app.models.directing import SceneEndFrameRecord
        async with sessions.begin() as db:
            db.add(SceneEndFrameRecord(id='fixed-frame', version_id=version['id'], request_id='fixed-request',
                request={'request_id': 'fixed-request', 'expected_revision': saved['revision'], 'clip_id': 'clip'},
                clip=saved['content']['timeline']['items'][0], file_id='missing-frame-file', at_ms=960))
        projected_frames = (await client.get(detail)).json()['data']['edit_graph']['nodes']
        frame_node = next(node for node in projected_frames if node['kind'] == 'edit_end_frame')
        assert frame_node['frame']['clip']['id'] == 'clip'
        assert frame_node['frame']['at_ms'] == 960
        assert frame_node['frame']['matches_current'] is True
        assert frame_node['frame']['available'] is False
        review_path = detail + '/cut-reviews'
        request = {'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'decision': {
            'verdict': 'pass', 'overall': '画面叙事成立', 'established': '动作与反应连贯', 'coverage_status': 'verified',
            'coverage_notes': '已逐项核对当前计划与实际画面', 'issues': [], 'sound_status': 'pending_postproduction', 'sound_notes': '对白待后期'}}
        response = await client.post(review_path, json=request)
        assert response.status_code == 200, response.text
        review = response.json()['data']
        assert review['matches_current'] is True
        projected = (await client.get(detail)).json()['data']
        assert projected['revision'] == saved['revision']
        nodes = [node for node in projected['edit_graph']['nodes'] if node['kind'] == 'edit_cut_review']
        assert len(nodes) == 1
        assert nodes[0]['record_id'] == review['id']
        assert nodes[0]['matches_current'] is True
        assert nodes[0]['decision']['sound_status'] == 'pending_postproduction'
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
        unrelated_graph = unrelated_response.json()['data']['edit_graph']['nodes']
        assert next(node for node in unrelated_graph if node['kind'] == 'edit_cut_review')['matches_current'] is True
        assert next(node for node in unrelated_graph if node['kind'] == 'edit_end_frame')['frame']['matches_current'] is True
        current = unrelated_response.json()['data']
        interval = deepcopy(current['content'])
        interval['timeline']['items'][0]['media_range']['source_out_ms'] = 800
        interval_response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': interval})
        assert interval_response.status_code == 200, interval_response.text
        assert (await client.get(review_path)).json()['data'][0]['matches_current'] is False
        interval_nodes = interval_response.json()['data']['edit_graph']['nodes']
        assert next(node for node in interval_nodes if node['kind'] == 'edit_cut_review')['matches_current'] is False
        assert next(node for node in interval_nodes if node['kind'] == 'edit_end_frame')['frame']['matches_current'] is False
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


@pytest.mark.asyncio
async def test_version_lists_restore_oldest_applicable_cut_summary_after_many_other_bases(tmp_path):
    """版本和列表只有最新与最近适用摘要；历史量不会截断旧依据恢复。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        created = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '历史摘要'})).json()['data']
        detail = path + '/versions/' + created['id']
        content = deepcopy(created['content'])
        content['design'] = editable_design_sample()
        content['timeline']['items'] = [{'kind': 'planned', 'id': 'pending', 'shot_id': 's1', 'timeline_start_ms': 0, 'estimated_duration_ms': 1000}]
        saved = (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})).json()['data']
        original = deepcopy(saved['content'])
        first_id = None
        for index in range(36):
            if index:
                content = deepcopy(original)
                content['design']['direction']['viewpoint'] = {'state': 'proposal', 'text': f'固定历史依据 {index}', 'sources': [SOURCE]}
                response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': content})
                assert response.status_code == 200, response.text
                saved = response.json()['data']
            response = await client.post(detail + '/cut-reviews', json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'decision': {
                'verdict': 'revise', 'overall': f'固定结论 {index}', 'coverage_status': 'gaps', 'coverage_notes': '仍有占位', 'sound_status': 'pending_postproduction'}})
            assert response.status_code == 200, response.text
            first_id = first_id or response.json()['data']['id']
        changed = deepcopy(original)
        changed['output_aspect_ratio'] = '9:16'
        saved = (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': changed})).json()['data']
        nodes = [node for node in saved['edit_graph']['nodes'] if node['kind'] == 'edit_cut_review']
        assert len(nodes) == 1 and nodes[0]['matches_current'] is False
        restored = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': original})
        assert restored.status_code == 200, restored.text
        for projected in [restored.json()['data'], (await client.get(detail)).json()['data'], (await client.get(path + '/versions')).json()['data'][0]]:
            nodes = [node for node in projected['edit_graph']['nodes'] if node['kind'] == 'edit_cut_review']
            assert len(nodes) == 2
            assert [node['matches_current'] for node in nodes] == [False, True]
            assert nodes[1]['record_id'] == first_id
