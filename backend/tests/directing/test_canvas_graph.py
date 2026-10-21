"""画布投影经真实版本接口读取和保存，不依赖前端关联业务数组。"""

from copy import deepcopy
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.contracts.directing.canvas_graph import (
    CanvasGraph, CanvasMember, CanvasObject, CanvasTarget, CanvasView, DesignCanvasNode,
    DirectorCanvasGraph, UnitCanvasGraph,
)
from app.services.directing.canvas_graph import GraphAssembler

from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_director_global_cards_read_and_save_the_same_revision(tmp_path):
    """原文与全场卡片具备真实展示载荷，保存后和内容一起推进。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        created = await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '共享图验收',
        })
        assert created.status_code == 200, created.text
        version = created.json()['data']
        graph = version['director_graph']
        assert graph['kind'] == 'director'
        assert graph['shot_count'] == 0
        assert (graph['version_id'], graph['revision']) == (version['id'], 1)
        source = next(node for node in graph['nodes'] if node['kind'] == 'source')
        assert source['title'] == '原文依据'
        assert source['text'] == version['content']['basis']['text']
        overview = next(node for node in graph['nodes'] if node['id'] == 'overview')
        assert overview['title'] == '全场叙事与约束'
        assert overview['summary'][0] == {'field': 'viewpoint', 'label': '观察视点', 'text': '未填写'}
        assert overview['edit_target']['object']['id'] == 'overview'
        assert graph['views'][0]['anchor_id'] == source['id']

        content = deepcopy(version['content'])
        content['design']['direction']['viewpoint'] = {
            'state': 'proposal', 'text': '跟随读信者观察变化',
            'sources': [{'kind': 'human', 'reference': 'canvas-contract', 'version': '1'}],
        }
        detail = path + '/versions/' + version['id']
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
        })
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        assert saved['director_graph']['revision'] == saved['revision'] == 2
        card = next(node for node in saved['director_graph']['nodes'] if node['id'] == 'overview')
        assert card['summary'][0]['text'] == '跟随读信者观察变化'
        assert card['edit_target']['object']['revision'] == 2
        reread = await client.get(detail)
        assert reread.status_code == 200
        assert reread.json()['data']['director_graph'] == saved['director_graph']


@pytest.mark.asyncio
async def test_director_shot_views_have_shared_readonly_members_and_real_edges(tmp_path):
    """镜头子图保留同一原对象，成员和预览计数由保存接口提供。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '共享对象子图',
        })).json()['data']
        content = deepcopy(version['content'])
        note = {'state': 'proposal', 'text': '读信后抬头',
                'sources': [{'kind': 'human', 'reference': 'graph-views', 'version': '1'}]}
        content['design']['events'] = [{'id': 'event', 'description': note}]
        content['design']['criteria'] = [{'id': 'criterion', 'requirement': note}]
        content['design']['direction']['shots'] = [
            {'id': key, 'beat_ids': [], 'event_ids': ['event'], 'blocking_state_ids': [],
             'participant_ids': [], 'criterion_ids': ['criterion'],
             'visible_result': note, 'narrative_function': note} for key in ['A', 'B']]
        response = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
        })
        assert response.status_code == 200, response.text
        graph = response.json()['data']['director_graph']
        assert graph['shot_count'] == 2
        views = {view['id']: view for view in graph['views']}
        assert {'scene', 'shot:A', 'shot:B'} <= views.keys()
        entry = next(member for member in views['scene']['members'] if member['node_id'] == 'shot:A')
        assert (entry['presentation'], entry['entry_view_id']) == ('entry', 'shot:A')
        members = {member['node_id']: member for member in views['shot:A']['members']}
        assert members['shot:A']['presentation'] == 'card'
        assert members['event:event']['presentation'] == 'reference'
        assert members['criterion:criterion']['presentation'] == 'reference'
        assert 'shot:B' not in members
        assert views['shot:A']['node_count'] == 3
        assert views['shot:A']['reference_count'] == 2
        assert len([node for node in graph['nodes'] if node['id'] == 'event:event']) == 1
        edges = {edge['id']: edge for edge in graph['edges']}
        assert {edges[key]['target'] for key in views['shot:A']['edge_ids']} == {'event:event', 'criterion:criterion'}
        event_edge = next(edges[key] for key in views['shot:A']['edge_ids']
                          if edges[key]['target'] == 'event:event')
        assert event_edge['sources'][0]['field'] == 'event_ids'
        assert event_edge['sources'][0]['object']['id'] == 'shot:A'


def editable_graph():
    """公开构建边界的已知小图；只有真实声明的字段可作为编辑目标。"""
    obj = CanvasObject(version_id='version', revision=7, kind='design', id='overview',
                       path=['direction'])
    node = DesignCanvasNode(id='overview', title='全场叙事与约束', object=obj,
        design_kind='overview', fields=['viewpoint'], scope_label='全场背景', scope_reason='背景说明',
        edit_target=CanvasTarget(node_id='overview', object=obj))
    builder = GraphAssembler('director', 'version', 7)
    builder.add_node(node)
    builder.add_view(CanvasView(id='scene', title='总览', anchor_id='overview',
                               members=[CanvasMember(node_id='overview', group='global')]))
    return builder.finish()


def test_graph_rejects_edit_target_for_an_undeclared_field():
    payload = editable_graph().model_dump()
    payload['nodes'][0]['edit_target']['field'] = 'another_units_configuration'
    with pytest.raises(ValidationError, match='target field'):
        CanvasGraph.model_validate(payload)


@pytest.mark.parametrize('invalid', [
    'duplicate_node', 'duplicate_view', 'missing_member', 'missing_anchor', 'missing_parent',
    'cyclic_parent', 'missing_entry', 'non_entry_target', 'missing_edge', 'dangling_endpoint',
    'business_edge_without_evidence', 'wrong_node_revision', 'wrong_target_revision',
    'missing_issue_target',
])
def test_common_graph_contract_rejects_invalid_references(invalid):
    """两个投影器共同遵守的数据边界，非法图不能被当作可展示结果。"""
    payload = editable_graph().model_dump()
    view = payload['views'][0]
    node = payload['nodes'][0]
    if invalid == 'duplicate_node':
        payload['nodes'].append(deepcopy(node))
    elif invalid == 'duplicate_view':
        payload['views'].append(deepcopy(view))
    elif invalid == 'missing_member':
        view['members'][0]['node_id'] = 'gone'
    elif invalid == 'missing_anchor':
        view['anchor_id'] = 'gone'
    elif invalid == 'missing_parent':
        view['parent_id'] = 'gone'
    elif invalid == 'cyclic_parent':
        view['parent_id'] = 'scene'
    elif invalid == 'missing_entry':
        view['members'][0].update(presentation='entry', entry_view_id='gone')
    elif invalid == 'non_entry_target':
        view['members'][0]['entry_view_id'] = 'scene'
    elif invalid == 'missing_edge':
        view['edge_ids'] = ['gone']
    elif invalid == 'dangling_endpoint':
        payload['edges'] = [{'id': 'edge', 'source': 'overview', 'target': 'gone',
                             'kind': 'guide', 'label': '布局'}]
    elif invalid == 'business_edge_without_evidence':
        payload['edges'] = [{'id': 'edge', 'source': 'overview', 'target': 'overview',
                             'kind': 'business', 'label': '真实关系'}]
    elif invalid == 'wrong_node_revision':
        node['object']['revision'] = 6
    elif invalid == 'wrong_target_revision':
        node['edit_target']['object']['revision'] = 6
    elif invalid == 'missing_issue_target':
        target = deepcopy(node['edit_target'])
        target['node_id'] = 'gone'
        payload['issues'] = [{'code': 'missing', 'message': '缺少对象', 'severity': 'warning',
                              'target': target}]
    with pytest.raises(ValidationError):
        CanvasGraph.model_validate(payload)


def test_historical_source_requires_explicit_external_context():
    payload = editable_graph().model_dump()
    target = deepcopy(payload['nodes'][0]['edit_target'])
    target['object'].update(version_id='historical-version', revision=2, id='removed-object')
    payload['nodes'][0]['sources'] = [target]
    with pytest.raises(ValidationError):
        CanvasGraph.model_validate(payload)
    target['external'] = True
    graph = CanvasGraph.model_validate(payload)
    assert graph.nodes[0].sources[0].object.id == 'removed-object'
    assert graph.nodes[0].sources[0].object.version_id == 'historical-version'
    payload['nodes'][0]['edit_target'] = target
    with pytest.raises(ValidationError, match='edit target'):
        CanvasGraph.model_validate(payload)


def test_builder_does_not_silently_replace_registered_objects():
    graph = editable_graph()
    builder = GraphAssembler('director', 'version', 7)
    builder.add_node(graph.nodes[0])
    with pytest.raises(ValueError, match='duplicate canvas node'):
        builder.add_node(graph.nodes[0].model_copy(update={'title': '不能静默替换'}))


@pytest.mark.asyncio
async def test_unit_graph_filters_share_one_unit_and_keep_its_complete_subgraph(tmp_path):
    """筛选只改变展示成员，不复制跨镜单元或裁掉其覆盖出现项。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '单元图范围',
        })).json()['data']
        content = deepcopy(version['content'])
        note = {'state': 'proposal', 'text': '可见结果',
                'sources': [{'kind': 'human', 'reference': 'unit-graph', 'version': '1'}]}
        content['design']['direction']['shots'] = [
            {'id': key, 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
             'participant_ids': [], 'criterion_ids': [],
             'visible_result': note, 'narrative_function': note} for key in ['A', 'B']]
        content['units'] = [{
            'id': 'shared', 'coverage': [
                {'id': 'first', 'shot_id': 'A', 'action_scope': '开门'},
                {'id': 'second', 'shot_id': 'B', 'action_scope': '回头'},
                {'id': 'third', 'shot_id': 'A', 'action_scope': '走出'}],
            'references': [], 'model_id': None, 'duration_ms': None, 'ratio': '16:9',
        }]
        response = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
        })
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        graph = saved['unit_graph']
        assert graph['kind'] == 'units'
        assert graph['revision'] == saved['director_graph']['revision'] == saved['revision']
        assert len([node for node in graph['nodes'] if node['kind'] == 'unit']) == 1
        views = {view['id']: view for view in graph['views']}
        for key in ['scene', 'shot:A', 'shot:B']:
            entry = next(row for row in views[key]['members'] if row['node_id'] == 'unit:shared')
            assert entry['entry_view_id'] == 'unit:shared'
        subgraph = views['unit:shared']
        assert subgraph['parent_id'] == 'scene'
        nodes = {node['id']: node for node in graph['nodes']}
        coverage = [nodes[row['node_id']] for row in subgraph['members']
                    if nodes[row['node_id']]['kind'] == 'unit_config'
                    and nodes[row['node_id']]['config_kind'] == 'coverage']
        assert {node['coverage_item_id'] for node in coverage} == {'first', 'second', 'third'}
        assert {node['shot_id'] for node in coverage} == {'A', 'B'}
        for member in subgraph['members']:
            card = nodes[member['node_id']]
            if card['kind'] != 'unit_config':
                continue
            addressed = saved['content']
            for segment in card['object']['path']:
                addressed = addressed[segment]
            if card['config_kind'] == 'coverage':
                assert addressed['id'] == card['coverage_item_id']
            elif card['config_kind'] in {'generation', 'dependencies'}:
                assert addressed['id'] == card['unit_id']
            elif card['config_kind'] == 'organization':
                assert {'reason', 'entry_state', 'exit_state', 'reference_requirements'} <= set(card['fields'])
        unit = nodes['unit:shared']
        assert unit['execution_scope_supported'] is False
        assert any(issue['code'] == 'single-coverage-required' for issue in unit['issues'])
        reference = next(node for node in graph['nodes'] if node['kind'] == 'unit_references')
        assert reference['binding_count'] == 0
        assert any(edge['source'] == reference['id'] and edge['target'] == unit['id']
                   and edge['category'] == 'input' for edge in graph['edges'])
        assert CanvasGraph.model_validate(graph).revision == saved['revision']

        # 人工填写组织要求沿用现有 Source，不冒充 AI 任务或自动绑定参考。
        content['units'][0]['organization'] = {
            'reason': '明确开门与回头的衔接', 'entry_state': '门关闭', 'exit_state': '走出',
            'reference_requirements': ['门的空间参考'], 'missing': [],
            'source': {'kind': 'human', 'reference': 'unit:shared:organization', 'version': '2'},
        }
        manual = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': content,
        })
        assert manual.status_code == 200, manual.text
        updated = manual.json()['data']
        assert updated['content']['unit_design_task_id'] is None
        assert updated['content']['units'][0]['references'] == []
        organization = next(node for node in updated['unit_graph']['nodes']
                            if node['kind'] == 'unit_config' and node['config_kind'] == 'organization')
        assert organization['summary'][0]['text'] == '门关闭'
        assert not any(row['field'] == 'reason' for row in organization['summary'])
        forged = deepcopy(content)
        forged['units'][0]['organization']['source'] = {
            'kind': 'model', 'reference': 'unit:shared:organization', 'version': '2',
        }
        rejected = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 3, 'content': forged,
        })
        assert rejected.status_code == 422


@pytest.mark.asyncio
async def test_unit_graph_basis_keeps_partial_execution_background_and_production_phases(tmp_path):
    """画布依据复用真实单元范围，不把完整镜头结果提升成本次执行。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '单元执行依据',
        })).json()['data']
        content = deepcopy(version['content'])
        note = lambda text: {'state': 'proposal', 'text': text,
                            'sources': [{'kind': 'human', 'reference': 'scope-graph', 'version': '1'}]}
        content['design']['direction']['shots'] = [{
            'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': [], 'criterion_ids': [], 'visible_result': note('抬头后走出门'),
            'narrative_function': note('意识到来人'),
        }]
        content['design']['prompt']['prohibitions'] = note('画面不出现文字')
        content['design']['sound']['music_constraints'] = note('后期保留安静')
        content['design']['applicability'] = [{
            'subject': {'kind': 'sound', 'field': 'music_constraints'}, 'purpose': 'constraint',
            'scope': 'scene_rule', 'phase': 'postproduction',
        }]
        content['units'] = [{'id': 'partial', 'coverage': [
            {'id': 'opening', 'shot_id': 'shot', 'action_scope': '仅抬头'}],
            'references': [], 'model_id': None, 'duration_ms': None, 'ratio': '16:9'}]
        response = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
        })
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        graph = saved['unit_graph']
        basis = next(node for node in graph['nodes'] if node['kind'] == 'unit_basis')
        scope = basis['scope']
        assert [row['text'] for row in scope['execution']] == ['仅抬头']
        assert any(row['text'] == '抬头后走出门' for row in scope['background'])
        assert any(row['field'] == 'music_constraints' and row['phase'] == 'postproduction'
                   for row in scope['constraints'])
        assert any(row['field'] == 'prohibitions' and row['phase'] == 'video'
                   for row in scope['constraints'])
        execution_target = next(row['target'] for row in basis['field_targets']
                                if row['section'] == 'execution' and row['index'] == 0)
        assert execution_target['node_id'] == 'unit:partial:coverage:opening'
        assert execution_target['field'] == 'action_scope'
        background_target = next(row['target'] for row in basis['field_targets']
                                 if row['section'] == 'background'
                                 and row['target'] and row['target']['field'] == 'visible_result')
        assert background_target['external'] is True
        assert background_target['node_id'] == 'shot:shot'
        assert background_target['object'] == next(node['object'] for node in saved['director_graph']['nodes']
                                                    if node['id'] == 'shot:shot')
        assert any(member['node_id'] == basis['id'] for view in graph['views']
                   if view['id'] == 'unit:partial' for member in view['members'])
        for invalid in ['missing_address', 'duplicate_address', 'missing_source', 'unexplained_source']:
            malformed = deepcopy(graph)
            malformed_basis = next(node for node in malformed['nodes'] if node['kind'] == 'unit_basis')
            if invalid == 'missing_address':
                malformed_basis['field_targets'].pop()
            elif invalid == 'duplicate_address':
                malformed_basis['field_targets'].append(deepcopy(malformed_basis['field_targets'][0]))
            elif invalid == 'missing_source':
                malformed_basis['field_targets'][0]['target']['node_id'] = 'missing'
            else:
                malformed_basis['field_targets'][0]['target'] = None
            with pytest.raises(ValidationError, match='basis|canvas'):
                UnitCanvasGraph.model_validate(malformed)
        for graph_type, key in [(DirectorCanvasGraph, 'director_graph'), (UnitCanvasGraph, 'unit_graph')]:
            assert graph_type.model_validate(saved[key]).revision == saved['revision']

        from app.models.llm import Model, Provider

        async with sessions.begin() as db:
            db.add(Provider(id='graph-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add(Model(id='graph-model', name='execution-video', category='video', provider_id='graph-provider'))
        source = note('风格依据')['sources'][0]
        styles_path = path.split('/sequences/')[0] + '/styles'
        style_response = await client.post(styles_path, json={'content': {
            'title': '范围风格', 'sources': [source], 'rules': [
                {'id': 'active', 'role': 'cinematography', 'requirement': '保留低反差',
                 'status': 'confirmed', 'model_names': ['execution-video'], 'sources': [source]},
                {'id': 'other', 'role': 'direction', 'requirement': '其他模型的规则',
                 'status': 'confirmed', 'model_names': ['other-video'], 'sources': [source]},
                {'id': 'candidate', 'role': 'direction', 'requirement': '尚未确认的风格', 'sources': [source]},
            ],
        }})
        assert style_response.status_code == 200, style_response.text
        style = style_response.json()['data'][0]
        confirmed = await client.post(styles_path + '/' + style['id'] + '/confirm', json={'expected_version': 1})
        assert confirmed.status_code == 200, confirmed.text
        content['design']['style_revision_id'] = style['id']
        content['units'][0]['model_id'] = 'graph-model'
        styled = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': content,
        })
        assert styled.status_code == 200, styled.text
        nodes = styled.json()['data']['unit_graph']['nodes']
        styled_basis = next(node for node in nodes if node['kind'] == 'unit_basis')
        assert any(row['text'] == '保留低反差' for row in styled_basis['scope']['constraints'])
        assert not any(row['text'] in {'其他模型的规则', '尚未确认的风格'}
                       for row in styled_basis['scope']['constraints'])
        generation = next(node for node in nodes if node['kind'] == 'unit_config' and node['config_kind'] == 'generation')
        assert generation['summary'][0]['text'] == 'execution-video'
        async with sessions.begin() as db:
            model = await db.get(Model, 'graph-model')
            model.name = 'other-video'
        changed = (await client.get(path + '/versions/' + version['id'])).json()['data']
        assert changed['revision'] == 3
        changed_basis = next(node for node in changed['unit_graph']['nodes'] if node['kind'] == 'unit_basis')
        assert any(row['text'] == '其他模型的规则' for row in changed_basis['scope']['constraints'])
        assert not any(row['text'] == '保留低反差' for row in changed_basis['scope']['constraints'])
        async with sessions.begin() as db:
            await db.delete(await db.get(Model, 'graph-model'))
        missing_model = (await client.get(path + '/versions/' + version['id'])).json()['data']
        assert missing_model['revision'] == 3
        generation = next(node for node in missing_model['unit_graph']['nodes']
                          if node['kind'] == 'unit_config' and node['config_kind'] == 'generation')
        assert any(issue['code'] == 'model-unavailable' for issue in generation['issues'])
        unknown_scope = next(node['scope'] for node in missing_model['unit_graph']['nodes'] if node['kind'] == 'unit_basis')
        assert any('模型' in message for message in unknown_scope['unresolved'])


@pytest.mark.asyncio
async def test_unit_reference_graph_preserves_binding_roles_order_and_live_file_evidence(tmp_path):
    """同一文件的绑定相互独立；文件证据变化不伪装成新的业务 revision。"""
    from datetime import UTC, datetime
    from app.models.studio import FileItem

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '参考集合证据',
        })).json()['data']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{
            'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': [], 'criterion_ids': [], 'visible_result': {}, 'narrative_function': {},
        }]
        def binding(key, role, ordinal, purpose):
            return {'id': key, 'file_id': 'image1', 'media_kind': 'image', 'purpose': purpose,
                    'participant_ids': [], 'ordinal': ordinal, 'input_role': role,
                    'source': {'kind': 'file', 'reference': 'image1', 'version': '1', 'file_id': 'image1'}}
        content['units'] = [
            {'id': 'first', 'coverage': [{'id': 'c1', 'shot_id': 'shot', 'action_scope': '开门'}],
             'references': [binding('frame', 'first_frame', 1, 'composition'), binding('subject', 'subject', 0, 'identity')],
             'model_id': None, 'duration_ms': None, 'ratio': '16:9'},
            {'id': 'second', 'coverage': [{'id': 'c2', 'shot_id': 'shot', 'action_scope': '停步'}],
             'references': [binding('last', 'last_frame', 0, 'continuity')],
             'model_id': None, 'duration_ms': None, 'ratio': '16:9'},
        ]
        detail = path + '/versions/' + version['id']
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
        })
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        collections = {node['unit_id']: node for node in saved['unit_graph']['nodes']
                       if node['kind'] == 'unit_references'}
        first = collections['first']
        assert [row['id'] for row in first['bindings']] == ['subject', 'frame']
        assert [row['input_role'] for row in first['bindings']] == ['subject', 'first_frame']
        assert first['binding_count'] == 2
        assert collections['second']['bindings'][0]['input_role'] == 'last_frame'
        assert [row['binding_id'] for row in first['previews']] == ['subject', 'frame']
        assert all(row['display_name'] == '空间图' and row['status'] == 'available' for row in first['previews'])
        assert all(row['thumbnail_url'] == '/api/v1/studio/files/image1/download' for row in first['previews'])
        for invalid in ['wrong_count', 'wrong_file', 'duplicate_preview']:
            malformed = deepcopy(saved['unit_graph'])
            collection = next(node for node in malformed['nodes'] if node['kind'] == 'unit_references')
            if invalid == 'wrong_count':
                collection['binding_count'] = 99
            elif invalid == 'wrong_file':
                collection['previews'][0]['file_id'] = 'another-file'
            else:
                collection['previews'].append(deepcopy(collection['previews'][0]))
            with pytest.raises(ValidationError, match='canvas reference'):
                UnitCanvasGraph.model_validate(malformed)
        content['units'][0]['references'] = [content['units'][0]['references'][0]]
        removed = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': content,
        })
        assert removed.status_code == 200, removed.text
        second = next(node for node in removed.json()['data']['unit_graph']['nodes']
                      if node['kind'] == 'unit_references' and node['unit_id'] == 'second')
        assert second['bindings'] == collections['second']['bindings']
        async with sessions.begin() as db:
            file = await db.get(FileItem, 'image1')
            file.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        reread = (await client.get(detail)).json()['data']
        assert reread['revision'] == 3
        for node in reread['unit_graph']['nodes']:
            if node['kind'] == 'unit_references':
                assert node['previews'][0]['status'] == 'deleted'
                assert node['previews'][0]['thumbnail_url'] is None
                assert any(issue['code'] == 'reference-file-deleted' for issue in node['issues'])


@pytest.mark.asyncio
async def test_graph_generation_uses_actual_model_input_validation_without_submitting_tasks(tmp_path):
    """图与真实执行使用同一模型输入规则；改配置只保存，不提交生成任务。"""
    from app.models.llm import Model, Provider

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='input-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add(Model(id='input-video', name='sora-2', category='video', provider_id='input-provider'))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '输入准备诊断',
        })).json()['data']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{
            'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': [], 'criterion_ids': [], 'visible_result': {}, 'narrative_function': {},
        }]
        content['units'] = [{'id': 'unit', 'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '抬头'}],
                             'references': [], 'model_id': 'input-video', 'duration_ms': 8000,
                             'ratio': '16:9', 'parameters': {'unsupported': 1}}]
        detail = path + '/versions/' + version['id']
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
        })
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        generation = next(node for node in saved['unit_graph']['nodes']
                          if node['kind'] == 'unit_config' and node['config_kind'] == 'generation')
        assert generation['reference_capabilities']['frame_roles'] == ['first_frame']
        assert any('不支持参数' in issue['message'] for issue in generation['issues'])
        content['units'][0]['parameters'] = {}
        content['units'][0]['references'] = [{
            'id': 'subject', 'file_id': 'image1', 'media_kind': 'image', 'purpose': 'space',
            'participant_ids': [], 'ordinal': 0, 'input_role': 'subject',
            'source': {'kind': 'file', 'reference': 'image1', 'version': '1', 'file_id': 'image1'},
        }]
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': content,
        })
        assert response.status_code == 200, response.text
        reference = next(node for node in response.json()['data']['unit_graph']['nodes'] if node['kind'] == 'unit_references')
        assert any('不支持主体图片' in issue['message'] for issue in reference['issues'])
        async with sessions.begin() as db:
            provider = await db.get(Provider, 'input-provider')
            provider.name = 'unknown-provider'
        reread = (await client.get(detail)).json()['data']
        assert reread['revision'] == 3
        generation = next(node for node in reread['unit_graph']['nodes']
                          if node['kind'] == 'unit_config' and node['config_kind'] == 'generation')
        assert generation['reference_capabilities'] is None
        assert generation['capability_error']
        assert any(issue['code'] == 'capability-unverified' for issue in generation['issues'])
        assert (await client.get(detail + '/units/unit/video')).json()['data'] == []


@pytest.mark.asyncio
async def test_legacy_rows_remain_readonly_identities_scoped_to_their_revision(tmp_path):
    """旧行不在读取时补 ID；同名出现项各自保留地址，保存后旧临时目标不再复用。"""
    from app.models.directing import SceneVersionRecord

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        created = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '旧无 ID 工作单',
        })).json()['data']
        detail = path + '/versions/' + created['id']
        legacy = deepcopy(created['content'])
        legacy['design']['participants'] = [{'id': 'reader', 'name': '读信者'}]
        activity = {'participant_id': 'reader', 'depth': {},
            'ongoing_task': {'state': 'proposal', 'text': '手指停在旧信上',
                'sources': [{'kind': 'human', 'reference': 'legacy', 'version': '1'}]},
            'path': {}, 'attention': {}, 'reaction_delay': {}, 'intensity': {},
            'entrances_exits': {}, 'narrative_support': {}, 'end_state': {}}
        legacy['design']['staging']['activities'] = [activity, deepcopy(activity)]
        # 模拟历史持久化输入；之后所有行为都从正式版本 HTTP 边界观察。
        async with sessions.begin() as db:
            row = await db.get(SceneVersionRecord, created['id'])
            row.content = legacy
        first = (await client.get(detail)).json()['data']
        second = (await client.get(detail)).json()['data']
        assert first == second
        rows = first['content']['design']['staging']['activities']
        assert [row['id'] for row in rows] == [None, None]
        nodes = [node for node in first['director_graph']['nodes'] if node['kind'] == 'design'
                 and node['design_kind'] == 'activity']
        original_ids = {node['id'] for node in nodes}
        assert len(original_ids) == 2
        assert all(node['object']['stable'] is False and node['object']['revision'] == 1 for node in nodes)
        assert [node['object']['path'] for node in nodes] == [
            ['staging', 'activities', 0], ['staging', 'activities', 1]]
        updated = deepcopy(first['content'])
        updated['design']['direction']['viewpoint'] = {'state': 'proposal', 'text': '保留旧工作单',
            'sources': [{'kind': 'human', 'reference': 'legacy-editor', 'version': '1'}]}
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': updated})
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        assert saved['revision'] == 2
        assert [row['id'] for row in saved['content']['design']['staging']['activities']] == [None, None]
        revised = [node for node in saved['director_graph']['nodes'] if node['kind'] == 'design'
                   and node['design_kind'] == 'activity']
        revised_ids = {node['id'] for node in revised}
        assert len(revised_ids) == 2 and original_ids.isdisjoint(revised_ids)
        assert all(node['object']['stable'] is False and node['object']['revision'] == 2 for node in revised)
        assert (await client.get(detail)).json()['data'] == saved
