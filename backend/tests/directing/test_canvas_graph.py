"""画布投影经真实版本接口读取和保存，不依赖前端关联业务数组。"""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.core.contracts.directing.canvas_graph import (
    CanvasGraph, CanvasMember, CanvasObject, CanvasTarget, CanvasView, DesignCanvasNode,
)
from app.services.directing.canvas_graph import GraphAssembler



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
    'missing_issue_target', 'no_root_view', 'multiple_roots',
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
    elif invalid == 'no_root_view':
        payload['views'] = []
    elif invalid == 'multiple_roots':
        payload['views'].append({**deepcopy(view), 'id': 'another-root'})
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


def test_instruction_graph_rejects_edit_target_outside_the_free_text_body():
    """指令定位不能授权改写同一单元中的其他业务字段。"""
    payload = editable_graph().model_dump()
    old = payload['nodes'][0]
    obj = {**old['object'], 'kind': 'instruction'}
    payload['kind'] = 'instructions'
    payload['nodes'] = [{
        'id': old['id'], 'title': '当前指令', 'object': obj, 'kind': 'instruction',
        'unit_id': 'unit', 'text': '保留自由文本',
        'edit_target': {'node_id': old['id'], 'object': obj, 'field': 'model_id'},
    }]
    with pytest.raises(ValidationError, match='target field'):
        CanvasGraph.model_validate(payload)
