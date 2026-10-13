"""方案判断独立保存，既有 Take 的生产事实和共享注释保持不变。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.services.directing.store import DirectingStore
from tests.directing.samples import SOURCE, design_sample, plan_sample
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database, frozen, output


@pytest.mark.asyncio
async def test_versions_keep_independent_judgments_on_existing_take(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        sequence_id = path.rsplit('/', 1)[1]
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            design = await frozen(store, sequence_id, 'design', design_sample('dialogue'))
            plan = await frozen(store, sequence_id, 'plan', plan_sample(design.id))
            prompt = await frozen(store, sequence_id, 'prompt', {'plan_revision_id': plan.id, 'unit_id': 'u1',
                'format_version': 'fixture', 'text': '素材来源指令', 'sources': [SOURCE], 'decisions': []})
            await output(db, prompt.id)
            take = await store.register_take(prompt_revision_id=prompt.id, task_id='task1', output_ordinal=0)
            take_id = take.id
        original = (await client.get(path)).json()['data']['takes']
        versions = []
        for title, verdict, start, end in [('A', 'retain', 1000, 3000), ('B', 'repair', 4000, 8000)]:
            created = await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': title})
            assert created.status_code == 200, created.text
            version = created.json()['data']
            library = await client.get(path + '/versions/' + version['id'] + '/take-library')
            assert library.status_code == 200, library.text
            item = library.json()['data'][0]
            assert item['take_id'] == take_id and item['take_kind'] == 'production_plan'
            assert item['origin_id'] == plan.id
            assert item['file_id'] == 'video1' and item['duration_ms'] == 9000
            assert item['prompt']['text'] == '素材来源指令'
            assert item['media_url'] == '/api/v1/studio/files/video1/download'
            assert item['available'] is True
            unreviewed = await client.post(path + '/versions/' + version['id'] + '/take-reviews', json={
                'expected_revision': 1, 'take_kind': 'production_plan', 'take_id': take_id})
            assert unreviewed.status_code == 422, unreviewed.text
            content = deepcopy(version['content'])
            content['take_judgments'] = [{'take_kind': 'production_plan', 'take_id': take_id, 'file_id': 'video1',
                'annotation': {'coverage': [], 'review_status': 'reviewed', 'verdict': verdict, 'rationale': {},
                    'retained_ranges': [{'source_in_ms': start, 'source_out_ms': end}]}}]
            detail = path + '/versions/' + version['id']
            saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
            assert saved.status_code == 200, saved.text
            versions.append((detail, saved.json()['data']))
        for detail, saved in versions:
            assert (await client.get(detail)).json()['data'] == saved
        # 审查改变固定新记录；只改当前设计不会改写既有审片依据。
        a_path, a_saved = versions[0]
        review_response = await client.get(a_path + '/take-reviews')
        assert review_response.status_code == 200, review_response.text
        reviews = review_response.json()['data']
        assert len(reviews) == 1
        first_review = reviews[0]
        assert first_review['matches_current'] is True
        assert first_review['content']['take_judgments'] == a_saved['content']['take_judgments']
        changed = deepcopy(a_saved['content'])
        changed['design']['direction']['viewpoint'] = {'state': 'proposal', 'text': '后来改变的叙事视点', 'sources': [{'kind': 'human', 'reference': 'reviewer', 'version': '1'}]}
        request = {'request_id': str(uuid4()), 'expected_revision': a_saved['revision'], 'content': changed}
        changed_response = await client.put(a_path, json=request)
        assert changed_response.status_code == 200, changed_response.text
        assert (await client.put(a_path, json=request)).status_code == 200
        stale = (await client.get(a_path + '/take-reviews')).json()['data']
        assert len(stale) == 1
        assert stale[0] == {**first_review, 'matches_current': False}
        confirmation = {'expected_revision': changed_response.json()['data']['revision'],
            'take_kind': 'production_plan', 'take_id': take_id}
        confirmed = await client.post(a_path + '/take-reviews', json=confirmation)
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()['data']['matches_current'] is True
        assert confirmed.json()['data']['content']['take_judgments'] == first_review['content']['take_judgments']
        repeated = await client.post(a_path + '/take-reviews', json=confirmation)
        assert repeated.json()['data'] == confirmed.json()['data']
        assert (await client.get(a_path)).json()['data'] == changed_response.json()['data']
        assert len((await client.get(a_path + '/take-reviews')).json()['data']) == 2
        rejected = await client.post(a_path + '/take-reviews', json={**confirmation, 'expected_revision': 1})
        assert rejected.status_code == 409, rejected.text
        changed['take_judgments'][0]['annotation']['verdict'] = 'repair'
        request = {'request_id': str(uuid4()), 'expected_revision': changed_response.json()['data']['revision'], 'content': changed}
        reviewed = await client.put(a_path, json=request)
        assert reviewed.status_code == 200, reviewed.text
        assert (await client.put(a_path, json=request)).status_code == 200
        next_reviews = (await client.get(a_path + '/take-reviews')).json()['data']
        assert len(next_reviews) == 3
        assert next_reviews[0] == stale[0]
        assert next_reviews[1] == {**confirmed.json()['data'], 'matches_current': False}
        assert next_reviews[2]['matches_current'] is True
        historical = await client.post(a_path + '/take-reviews', json=confirmation)
        assert historical.json()['data'] == next_reviews[1]
        assert len((await client.get(a_path + '/take-reviews')).json()['data']) == 3
        assert next_reviews[2]['content']['design']['direction']['viewpoint']['text'] == '后来改变的叙事视点'
        assert len((await client.get(versions[1][0] + '/take-reviews')).json()['data']) == 1
        # 剪辑采用与素材审查独立；改变时间线不使既有素材结论失效。
        editing = deepcopy(reviewed.json()['data']['content'])
        editing['timeline']['items'] = [{'kind': 'media', 'id': 'clip', 'take_kind': 'production_plan',
            'take_id': take_id, 'file_id': 'video1', 'media_range': {'source_in_ms': 1000, 'source_out_ms': 2000}, 'timeline_start_ms': 5000}]
        timeline_saved = await client.put(a_path, json={'request_id': str(uuid4()), 'expected_revision': reviewed.json()['data']['revision'], 'content': editing})
        assert timeline_saved.status_code == 200, timeline_saved.text
        assert (await client.get(a_path + '/take-reviews')).json()['data'] == next_reviews
        chapter_path = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = (await client.get(chapter_path)).json()['data']
        other = await client.post(chapter_path + '/sequences', json={'title': '另一场', 'position': 1,
            'source_version': chapter['source_version'], 'span': {'start': 4, 'end': 7}})
        assert other.status_code == 200, other.text
        other_path = '/api/v1/studio/projects/p1/directing/sequences/' + other.json()['data']['id']
        created = await client.post(other_path + '/versions', json={'request_id': str(uuid4()), 'title': '另一场方案'})
        assert created.status_code == 200, created.text
        foreign = created.json()['data']
        invalid = deepcopy(foreign['content'])
        invalid['take_judgments'] = saved['content']['take_judgments']
        other_detail = other_path + '/versions/' + foreign['id']
        rejected = await client.put(other_detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': invalid})
        assert rejected.status_code == 422, rejected.text
        assert (await client.get(other_detail)).json()['data'] == foreign
        assert (await client.get(path)).json()['data']['takes'] == original
        assert (await client.get(path)).json()['data']['takes'] == original
        detail, saved = versions[1]
        for bad_file, end in [('video2', 8000), ('video1', 9001)]:
            invalid = deepcopy(saved['content'])
            invalid['take_judgments'][0]['file_id'] = bad_file
            invalid['take_judgments'][0]['annotation']['retained_ranges'][0]['source_out_ms'] = end
            rejected = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': invalid})
            assert rejected.status_code == 422, rejected.text
            assert (await client.get(detail)).json()['data'] == saved
