"""章节只消费明确交付的固定内容，不跟随场次编辑。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_chapter_delivery_is_explicit_fixed_and_original_retry_does_not_reactivate(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '章节使用 A'})).json()['data']
        detail = path + '/versions/' + version['id']
        chapter = path.split('/sequences/')[0] + '/chapters/' + version['chapter_id'] + '/deliveries'
        initial = await client.get(chapter)
        assert initial.status_code == 200, initial.text
        assert initial.json()['data']['sequences'][0]['delivery'] is None
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['timeline']['items'] = [{'kind': 'planned', 'id': 'planned', 'shot_id': 'shot', 'timeline_start_ms': 500, 'estimated_duration_ms': 1500}]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        version = saved.json()['data']
        request = {'request_id': str(uuid4()), 'expected_revision': version['revision']}
        response = await client.post(detail + '/deliveries', json=request)
        assert response.status_code == 200, response.text
        first = response.json()['data']
        assert first['content'] == version['content']
        assert first['review'] is None and first['review_id'] is None
        assert first['version_title'] == '章节使用 A'
        assert (await client.get(chapter)).json()['data']['sequences'][0]['delivery'] == first
        content['output_aspect_ratio'] = '9:16'
        content['timeline']['items'][0]['estimated_duration_ms'] = 2000
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': version['revision'], 'content': content})
        assert saved.status_code == 200, saved.text
        assert (await client.get(chapter)).json()['data']['sequences'][0]['delivery'] == first
        assert (await client.post(detail + '/deliveries', json={'request_id': str(uuid4()), 'expected_revision': version['revision']})).status_code == 409
        second = (await client.post(detail + '/deliveries', json={'request_id': str(uuid4()), 'expected_revision': saved.json()['data']['revision']})).json()['data']
        assert second['content']['output_aspect_ratio'] == '9:16'
        assert second['id'] != first['id']
        assert (await client.post(detail + '/deliveries', json=request)).json()['data'] == first
        assert (await client.get(chapter)).json()['data']['sequences'][0]['delivery'] == second
        assert (await client.post(detail + '/deliveries', json={**request, 'expected_revision': saved.json()['data']['revision']})).status_code == 409
        history = (await client.get(path + '/deliveries')).json()['data']
        assert [row['id'] for row in history] == [first['id'], second['id']]
        assert (await client.get(detail)).json()['data'] == saved.json()['data']


@pytest.mark.asyncio
async def test_delivery_freezes_only_review_matching_actual_content(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '固定审片'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = version['content']
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['timeline']['items'] = [{'kind': 'planned', 'id': 'planned', 'shot_id': 'shot', 'timeline_start_ms': 0, 'estimated_duration_ms': 1500}]
        version = (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})).json()['data']
        decision = {'verdict': 'revise', 'overall': '待拍素材', 'coverage_status': 'gaps', 'coverage_notes': '本段还没有真实素材', 'sound_status': 'pending_postproduction'}
        reviewed = await client.post(detail + '/cut-reviews', json={'request_id': str(uuid4()), 'expected_revision': version['revision'], 'decision': decision})
        assert reviewed.status_code == 200, reviewed.text
        first = (await client.post(detail + '/deliveries', json={'request_id': str(uuid4()), 'expected_revision': version['revision']})).json()['data']
        assert first['review_id'] == reviewed.json()['data']['id']
        assert first['review']['coverage_status'] == 'gaps'
        content['output_aspect_ratio'] = '1:1'
        saved = (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': version['revision'], 'content': content})).json()['data']
        second = (await client.post(detail + '/deliveries', json={'request_id': str(uuid4()), 'expected_revision': saved['revision']})).json()['data']
        assert second['review'] is None and second['review_id'] is None
        assert (await client.get(path + '/deliveries')).json()['data'][0] == first
