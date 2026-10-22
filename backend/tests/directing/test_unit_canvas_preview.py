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
        content['design']['direction']['shots'][0]['visible_result'] = {}
        graph = (await client.post(detail + '/unit-canvas/preview', json={
            'expected_revision': 1, 'content': content,
        })).json()['data']
        issue = next(issue for issue in graph['issues'] if '镜头尚无可见结果' in issue['message'])
        assert issue['target']['node_id'] == 'shot:shot'
        assert issue['target']['field'] == 'visible_result'
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


@pytest.mark.asyncio
@pytest.mark.parametrize('case', ['pair', 'duplicate', 'unsupported', 'mixed', 'missing', 'wrong_kind', 'foreign'])
async def test_frame_preview_preserves_positions_and_exposes_input_guards(tmp_path, case):
    """真实草稿投影与保存使用同一帧位置；非法组合可修正，非法文件不能落盘。"""
    from app.models.llm import Model, Provider
    from app.models.studio import FileUsage

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='frames', name='openai' if case == 'unsupported' else 'Vidu',
                            base_url='https://provider.example', api_key='fixture'))
            await db.flush()
            db.add(Model(id='frames-model', provider_id='frames', category='video', name='sora-2' if case == 'unsupported' else 'viduq2'))
            if case == 'foreign':
                db.add(FileUsage(file_id='image1', project_id='p2', usage_kind='upload', source_ref='foreign'))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '帧输入边界'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'visible_result': {}, 'narrative_function': {}}]
        references = [{'id': key, 'file_id': 'image1', 'media_kind': 'image', 'purpose': 'composition',
            'participant_ids': [], 'ordinal': ordinal, 'input_role': role,
            'source': {'kind': 'human', 'reference': 'author', 'version': '1'}}
            for ordinal, (key, role) in enumerate([('first', 'first_frame'), ('last', 'last_frame')])]
        if case == 'duplicate':
            references[1]['input_role'] = 'first_frame'
        if case == 'mixed':
            references[1]['input_role'] = 'subject'
        if case in {'missing', 'wrong_kind'}:
            references[0]['file_id'] = 'missing-file' if case == 'missing' else 'video1'
        content['units'] = [{'id': 'unit', 'model_id': 'frames-model', 'duration_ms': 5000,
            'ratio': '16:9', 'instruction': '人物抬头。', 'references': references,
            'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '抬头'}]}]
        preview = await client.post(detail + '/unit-canvas/preview', json={'expected_revision': 1, 'content': content})
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        if case in {'missing', 'wrong_kind', 'foreign'}:
            assert saved.status_code == (404 if case == 'missing' else 422), saved.text
            assert (await client.get(detail)).json()['data']['revision'] == 1
        else:
            assert preview.status_code == saved.status_code == 200, (preview.text, saved.text)
            draft_graph, saved_graph = preview.json()['data'], saved.json()['data']['unit_graph']
            cards = lambda graph: {node['id']: (node['input_role'], node['bindings'], node['edit_target']['object']['path'])
                for node in graph['nodes'] if node['kind'] == 'unit_references'}
            assert cards(draft_graph) == cards(saved_graph)
            edges = lambda graph: [(edge['source'], edge['target']) for edge in graph['edges'] if edge['category'] == 'input']
            assert edges(draft_graph) == edges(saved_graph)
            if case == 'pair':
                assert [binding['input_role'] for binding in saved.json()['data']['content']['units'][0]['references']] == ['first_frame', 'last_frame']
            else:
                expected = {'duplicate': '首帧或尾帧只能选择一份图片', 'unsupported': '不支持所选帧位置', 'mixed': '不支持主体参考与帧参考组合'}[case]
                assert any(expected in issue['message'] for issue in saved_graph['issues']), saved_graph['issues']
        assert (await client.get(detail + '/units/unit/video')).json()['data'] == []
