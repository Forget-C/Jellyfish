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
async def test_seam_reviews_only_depend_on_the_original_adjacent_media_pair(tmp_path):
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
        content['timeline']['items'] = [{'kind': 'media', 'id': clip_id, 'take_kind': 'production_plan', 'take_id': take_id, 'file_id': 'video1',
            'media_range': {'source_in_ms': 0, 'source_out_ms': 1000}, 'timeline_start_ms': position}
            for clip_id, position in [('left', 0), ('right', 1000), ('unrelated', 3000)]]
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        review_path = detail + '/seam-reviews'
        request = {'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'left_clip_id': 'left', 'right_clip_id': 'right',
            'decision': {'verdict': 'pass', 'observation': '落幅与入幅方向连续', 'established': '动作接续成立', 'issues': ''}}
        response = await client.post(review_path, json=request)
        assert response.status_code == 200, response.text
        review = response.json()['data']
        assert review['matches_current'] is True
        assert review['content'] == saved['content']
        assert (await client.post(review_path, json=request)).json()['data'] == review
        assert len((await client.get(review_path)).json()['data']) == 1
        current = saved
        for change, expected_match in [('unrelated', True), ('crop', False), ('restore', True), ('ratio', False), ('restore_ratio', True), ('range', False), ('restore_range', True), ('move_pair', True), ('gap', False), ('placeholder', False)]:
            edited = deepcopy(current['content'])
            items = edited['timeline']['items']
            if change == 'unrelated':
                items[2]['fit'] = 'cover'
            elif change == 'crop':
                items[0]['fit'] = 'cover'
            elif change == 'restore':
                items[0]['fit'] = 'contain'
            elif change == 'ratio':
                edited['output_aspect_ratio'] = '9:16'
            elif change == 'restore_ratio':
                edited['output_aspect_ratio'] = '16:9'
            elif change in ('range', 'restore_range'):
                items[0]['media_range']['source_out_ms'] = 900 if change == 'range' else 1000
                items[1]['timeline_start_ms'] = items[0]['media_range']['source_out_ms']
            elif change == 'move_pair':
                items[0]['timeline_start_ms'] = 500
                items[1]['timeline_start_ms'] = 1500
            elif change == 'gap':
                items[1]['timeline_start_ms'] = 1600
            else:
                items[1] = {'kind': 'planned', 'id': 'right', 'shot_id': 's1', 'estimated_duration_ms': 1000, 'timeline_start_ms': 1500}
            response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': edited})
            assert response.status_code == 200, response.text
            current = response.json()['data']
            rows = (await client.get(review_path)).json()['data']
            assert rows == [{**review, 'matches_current': expected_match}]
            assert (await client.post(review_path, json=request)).json()['data'] == rows[0]
            if change in ('gap', 'placeholder'):
                rejected = await client.post(review_path, json={**request, 'request_id': str(uuid4()), 'expected_revision': current['revision']})
                assert rejected.status_code == 422, rejected.text
        changed_request = deepcopy(request)
        changed_request['decision']['observation'] = '不得重用原身份改写结论'
        assert (await client.post(review_path, json=changed_request)).status_code == 409
        assert (await client.post(review_path, json={**request, 'request_id': str(uuid4())})).status_code == 409
        assert (await client.get(path)).json()['data']['takes'] == original
