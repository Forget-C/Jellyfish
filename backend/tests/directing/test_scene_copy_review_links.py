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
async def test_copy_preserves_take_and_seam_review_links_independently(tmp_path):
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
        content['take_judgments'] = [{'take_kind': 'production_plan', 'take_id': take_id, 'file_id': 'video1',
            'annotation': {'coverage': [], 'review_status': 'reviewed', 'verdict': 'retain', 'rationale': {},
                'retained_ranges': [{'source_in_ms': 0, 'source_out_ms': 1000}]}}]
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
        take_reviews = (await client.get(detail + '/take-reviews')).json()['data']
        assert len(take_reviews) == 1
        copy_response = await client.post(detail + '/copy', json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'title': '副本', 'content': saved['content']})
        assert copy_response.status_code == 200, copy_response.text
        copied = copy_response.json()['data']
        copied_path = path + '/versions/' + copied['id']
        assert (await client.get(copied_path + '/take-reviews')).json()['data'] == take_reviews
        assert (await client.get(copied_path + '/seam-reviews')).json()['data'] == [review]
        second = await client.post(copied_path + '/copy', json={'request_id': str(uuid4()), 'expected_revision': 1, 'title': '再次另存', 'content': copied['content']})
        assert second.status_code == 200, second.text
        second_path = path + '/versions/' + second.json()['data']['id']
        assert (await client.get(second_path + '/take-reviews')).json()['data'] == take_reviews
        assert (await client.get(second_path + '/seam-reviews')).json()['data'] == [review]
        later = await client.post(review_path, json={**request, 'request_id': str(uuid4()), 'decision': {**request['decision'], 'observation': '原版本后来再次审查'}})
        assert later.status_code == 200, later.text
        edited = deepcopy(saved['content'])
        edited['take_judgments'][0]['annotation']['verdict'] = 'repair'
        changed = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': edited})
        assert changed.status_code == 200, changed.text
        assert (await client.get(copied_path + '/take-reviews')).json()['data'] == take_reviews
        assert (await client.get(copied_path + '/seam-reviews')).json()['data'] == [review]
        edited_copy = deepcopy(copied['content'])
        edited_copy['timeline']['items'][0]['fit'] = 'cover'
        edited_copy['take_judgments'][0]['annotation']['retained_ranges'][0]['source_out_ms'] = 800
        changed_copy = await client.put(copied_path, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': edited_copy})
        assert changed_copy.status_code == 200, changed_copy.text
        assert (await client.get(copied_path + '/seam-reviews')).json()['data'] == [{**review, 'matches_current': False}]
        copied_reviews = (await client.get(copied_path + '/take-reviews')).json()['data']
        assert copied_reviews[0] == {**take_reviews[0], 'matches_current': False}
        assert len(copied_reviews) == 2 and copied_reviews[1]['version_id'] == copied['id']
        assert copied_reviews[1]['matches_current']
        assert (await client.get(detail)).json()['data'] == changed.json()['data']
        assert (await client.get(second_path + '/take-reviews')).json()['data'] == take_reviews
        assert (await client.get(path)).json()['data']['takes'] == original
