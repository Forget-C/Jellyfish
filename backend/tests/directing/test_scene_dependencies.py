"""场次落幅依赖保存与执行门禁通过真实 HTTP 验证。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database
from tests.directing.samples import complete_shot_scope_sample


@pytest.mark.asyncio
async def test_unbound_scene_dependency_only_blocks_its_unit_and_rejects_forged_evidence(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '落幅依赖'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = version['content']
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': identity, 'ratio': '16:9', 'coverage': [{'id': 'coverage', 'shot_id': 'shot'}]} for identity in ['affected', 'independent']]
        complete_shot_scope_sample(content, '固定画面')
        content['units'][0]['scene_dependencies'] = [{'version_id': version['id'], 'clip_id': 'removed-clip'}]
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        for identity, message in [('affected', '实际落幅'), ('independent', '指令检查')]:
            response = await client.post(detail + '/units/' + identity + '/video/prepare', json={'expected_revision': saved['revision']})
            assert response.status_code == 409, response.text
            assert message in response.text
        for invalid in ['missing-version', 'missing-frame', 'unpaired', 'duplicate']:
            candidate = deepcopy(saved['content'])
            link = candidate['units'][0]['scene_dependencies'][0]
            if invalid == 'missing-version':
                link['version_id'] = 'missing-version'
            elif invalid == 'missing-frame':
                link.update(frame_id='fake', reference_id='fake')
            elif invalid == 'unpaired':
                link['frame_id'] = 'fake'
            else:
                candidate['units'][0]['scene_dependencies'].append(deepcopy(link))
            rejected = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': candidate})
            assert rejected.status_code == 422, (invalid, rejected.text)
        assert (await client.get(detail)).json()['data'] == saved
