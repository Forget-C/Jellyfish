"""新时间线落幅只从明确保存的真实采用提取，空轨和占位不能冒充媒体。"""
from uuid import uuid4

import pytest

from tests.directing.samples import design_sample
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_scene_end_frame_rejects_empty_planned_and_stale_sources(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '实际落幅'})).json()['data']
        detail = path + '/versions/' + version['id']
        frames = detail + '/end-frames'
        response = await client.get(frames)
        assert response.status_code == 200, response.text
        assert response.json()['data'] == []
        request = {'request_id': str(uuid4()), 'expected_revision': version['revision'], 'clip_id': 'planned'}
        assert (await client.post(frames, json=request)).status_code == 422
        content = version['content']
        content['design'] = design_sample()
        content['timeline']['items'] = [{'kind': 'planned', 'id': 'planned', 'shot_id': 's1', 'timeline_start_ms': 0, 'estimated_duration_ms': 1000}]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': version['revision'], 'content': content})
        assert saved.status_code == 200, saved.text
        assert (await client.post(frames, json=request)).status_code == 409
        request['expected_revision'] = saved.json()['data']['revision']
        assert (await client.post(frames, json=request)).status_code == 422
        assert (await client.get(frames)).json()['data'] == []
        assert (await client.get(detail)).json()['data'] == saved.json()['data']
