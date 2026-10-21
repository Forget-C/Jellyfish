"""场次落幅依赖保存与执行门禁通过真实 HTTP 验证。"""
from copy import deepcopy
from uuid import uuid4

import pytest
from pydantic import ValidationError
from app.core.contracts.directing.canvas_graph import UnitCanvasGraph

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
        card = next(node for node in saved['unit_graph']['nodes'] if node['kind'] == 'unit_config'
                    and node['unit_id'] == 'affected' and node['config_kind'] == 'dependencies')
        evidence = card['dependency_evidence'][0]
        assert evidence['kind'] == 'scene'
        assert evidence['version_id'] == version['id'] and evidence['clip_id'] == 'removed-clip'
        assert evidence['status'] == 'unbound'
        assert evidence['frame_id'] is None and evidence['source'] is None
        downstream = [node for node in saved['edit_graph']['nodes'] if node['kind'] == 'edit_downstream']
        assert len(downstream) == 1
        assert downstream[0]['unit_id'] == 'affected'
        assert downstream[0]['dependency'] == evidence
        assert any(issue['code'] == 'dependency-unbound' for issue in card['issues'])
        malformed = deepcopy(saved['unit_graph'])
        malformed_card = next(node for node in malformed['nodes'] if node['id'] == card['id'])
        malformed_card['dependency_evidence'][0]['status'] = 'current'
        with pytest.raises(ValidationError, match='dependency evidence'):
            UnitCanvasGraph.model_validate(malformed)
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


@pytest.mark.asyncio
async def test_plan_frame_graph_rechecks_actual_adoption_without_changing_scene_revision(tmp_path, monkeypatch):
    """固定计划落幅复用真实采用门禁；外部变化只影响依赖该落幅的单元。"""
    from datetime import datetime, timezone

    from app.models.studio import FileItem
    from tests.directing.test_continuity import story
    from tests.directing.test_store import frozen

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            service, sequence_id, _, cut, frames = await story(db, monkeypatch)
            frame_rows = [frames['aend'], frames['cend']]
            sources = [(frame.id, frame.file_id, frame.plan_revision_id, frame.unit_id, frame.take_id)
                       for frame in frame_rows]
            cut_payload = deepcopy(cut.payload)
        path = f'/api/v1/studio/projects/p1/directing/sequences/{sequence_id}/versions'
        response = await client.post(path, json={'request_id': str(uuid4()), 'title': '固定计划落幅投影'})
        assert response.status_code == 200, response.text
        version = response.json()['data']
        detail = path + '/' + version['id']
        content = version['content']
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['units'] = []
        for identity, (frame_id, file_id, plan_id, source_unit_id, _) in zip(['affected', 'independent'], sources):
            content['units'].append({'id': identity, 'ratio': '16:9',
                'coverage': [{'id': 'coverage', 'shot_id': 'shot'}],
                'references': [{'id': 'actual-frame', 'file_id': file_id, 'media_kind': 'image',
                    'purpose': 'continuity', 'participant_ids': [], 'ordinal': 0, 'input_role': 'first_frame',
                    'source': {'kind': 'human', 'reference': 'author', 'version': '1'}}],
                'dependencies': [{'plan_revision_id': plan_id, 'unit_id': source_unit_id,
                    'frame_id': frame_id, 'reference_id': 'actual-frame'}]})
        complete_shot_scope_sample(content, '固定画面')
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        saved = response.json()['data']

        def dependencies(snapshot):
            return {node['unit_id']: node['dependency_evidence'][0] for node in snapshot['unit_graph']['nodes']
                    if node['kind'] == 'unit_config' and node['config_kind'] == 'dependencies'}

        evidence = dependencies(saved)
        for identity, (frame_id, file_id, plan_id, source_unit_id, take_id) in zip(['affected', 'independent'], sources):
            assert evidence[identity]['kind'] == 'plan'
            assert evidence[identity]['status'] == 'current'
            assert evidence[identity]['frame_id'] == frame_id
            assert evidence[identity]['frame_file_id'] == file_id
            assert evidence[identity]['plan_revision_id'] == plan_id
            assert evidence[identity]['unit_id'] == source_unit_id
            assert evidence[identity]['at_ms'] == 2999
            assert evidence[identity]['source']['reference'] == take_id
            assert evidence[identity]['source']['media_range'] == {'source_in_ms': 2999, 'source_out_ms': 3000}
        async with sessions.begin() as db:
            from app.services.directing.continuity import ContinuityService
            cut_payload['items'][0]['media_range']['source_out_ms'] = 2500
            await frozen(ContinuityService(db, 'p1'), sequence_id, 'cut', cut_payload)
        changed = (await client.get(detail)).json()['data']
        assert changed['revision'] == saved['revision'] and changed['content'] == saved['content']
        evidence = dependencies(changed)
        assert evidence['affected']['status'] == 'needs_review'
        assert evidence['affected']['frame_id'] == sources[0][0]
        assert evidence['independent']['status'] == 'current'
        async with sessions.begin() as db:
            file = await db.get(FileItem, sources[0][1])
            file.delete_requested_at = datetime.now(timezone.utc)
        unavailable = (await client.get(detail)).json()['data']
        assert unavailable['revision'] == saved['revision'] and unavailable['content'] == saved['content']
        evidence = dependencies(unavailable)
        assert evidence['affected']['status'] == 'unavailable'
        assert evidence['affected']['frame_id'] == sources[0][0]
        assert evidence['independent']['status'] == 'current'
