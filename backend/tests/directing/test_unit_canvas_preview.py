"""当前编辑的单元画布通过只读 HTTP 投影，不依赖保存成功。"""

from copy import deepcopy
from uuid import uuid4

import pytest

from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_unsaved_units_are_visible_without_saving_the_version(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '当前编辑画布',
        })).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{
            'id': 'shot', 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [],
            'participant_ids': [], 'narrative_function': {}, 'visible_result': {
                'text': '拆开信封', 'state': 'proposal',
                'sources': [{'kind': 'human', 'reference': 'fixture', 'version': '1'}]}}]
        content['units'] = [{'id': 'draft-unit', 'ratio': '16:9', 'coverage': [
            {'id': 'draft-coverage', 'shot_id': 'shot', 'action_scope': '拆开信封'}]}]
        response = await client.post(detail + '/unit-canvas/preview', json={
            'expected_revision': version['revision'], 'content': content,
        })
        assert response.status_code == 200, response.text
        graph = response.json()['data']
        assert graph['version_id'] == version['id'] and graph['revision'] == 1
        assert any(node['kind'] == 'unit' and node['unit_id'] == 'draft-unit'
                   for node in graph['nodes'])
        coverage = next(node for node in graph['nodes'] if node.get('config_kind') == 'coverage')
        assert next(field['text'] for field in coverage['summary']
                    if field['field'] == 'action_scope') == '拆开信封'
        saved = (await client.get(detail)).json()['data']
        assert saved['revision'] == 1 and saved['content'] == version['content']

        content['units'][0]['organization'] = {
            'reason': '单独拍摄拆信', 'reference_requirements': ['信封主体参考'],
            'source': {'kind': 'human', 'reference': 'fixture', 'version': '1'},
        }
        graph = (await client.post(detail + '/unit-canvas/preview', json={
            'expected_revision': 1, 'content': content,
        })).json()['data']
        issue = next(issue for issue in graph['issues'] if issue['message'] == '参考待绑定：信封主体参考')
        assert issue['target']['node_id'] == 'unit:draft-unit:organization'
        assert issue['target']['field'] == 'reference_requirements'

        content['design']['events'] = [{'id': 'event', 'description': {}}]
        content['design']['direction']['shots'][0]['event_ids'] = ['event']
        content['units'][0]['coverage'][0]['event_ids'] = ['event']
        graph = (await client.post(detail + '/unit-canvas/preview', json={
            'expected_revision': 1, 'content': content,
        })).json()['data']
        issue = next(issue for issue in graph['issues'] if issue['message'] == '已选事件 event 尚无可拍内容')
        assert issue['target']['node_id'] == 'event:event'
        assert issue['target']['external'] is True and issue['target']['field'] == 'description'
        assert (await client.get(detail + '/unit-design-suggestions')).json()['data'] == []


@pytest.mark.asyncio
async def test_preview_rejects_stale_baselines_and_foreign_or_invalid_targets(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '预览边界',
        })).json()['data']
        detail = path + '/versions/' + version['id']
        body = {'expected_revision': 1, 'content': version['content']}
        for url, request, status in [
            (detail, {**body, 'expected_revision': 2}, 409),
            (detail, {**body, 'expected_revision': 0}, 422),
            (detail.replace('/projects/p1/', '/projects/p2/'), body, 422),
            (path + '/versions/unknown-version', body, 422),
            (detail, {**body, 'content': {**version['content'], 'units': [
                {'id': 'invalid-unit', 'ratio': '16:9', 'coverage': [
                    {'id': 'coverage', 'shot_id': 'missing-shot'}]}]}}, 422),
        ]:
            response = await client.post(url + '/unit-canvas/preview', json=request)
            assert response.status_code == status, response.text
        saved = (await client.get(detail)).json()['data']
        assert saved['revision'] == 1 and saved['content'] == version['content']
