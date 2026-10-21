"""指令展示复用同一快照的实际消费范围与参考证据，不再次读取版本。"""

from app.core.contracts.directing.canvas_graph import (
    CanvasEdge, CanvasMember, CanvasObject, CanvasSummaryField, CanvasTarget, CanvasView,
    InstructionCanvasGraph, InstructionCanvasNode, UnitCanvasGraph,
)
from app.services.directing.canvas_graph import CanvasReadContext, GraphAssembler


def instruction_graph(context: CanvasReadContext, units: UnitCanvasGraph) -> InstructionCanvasGraph:
    """每单元保留完整正文、真实依据和绑定集合；根视图仅是协议根。"""
    graph = GraphAssembler('instructions', context.version_id, context.revision)
    graph.add_view(CanvasView(id='scene', title='指令', members=[]))
    for index, unit in enumerate(context.content.units):
        view_id = f'instruction-unit:{unit.id}'
        selected = [node.model_copy(deep=True) for node in units.nodes
                    if node.kind in ('unit_basis', 'unit_references') and node.unit_id == unit.id]
        for node in selected:
            node.home_view_id = view_id
            node.edit_target = None
            if node.kind == 'unit_basis':
                for row in node.field_targets:
                    if row.target:
                        row.target.external = True
            graph.add_node(node)
        obj = CanvasObject(version_id=context.version_id, revision=context.revision,
            kind='instruction', id=unit.id, path=['units', index, 'instruction'])
        body = InstructionCanvasNode(id=f'instruction:{unit.id}', title='当前指令', object=obj,
            unit_id=unit.id, text=unit.instruction or '', source=unit.instruction_source,
            home_view_id=view_id, summary=[CanvasSummaryField(field='instruction', label='已保存正文',
                text=unit.instruction or '尚未填写')])
        body.edit_target = CanvasTarget(node_id=body.id, object=obj, field='instruction')
        body.issues = [issue.model_copy(update={'target': body.edit_target})
            for node in units.nodes
            if node.kind in ('unit', 'unit_config') and node.unit_id == unit.id
            for issue in node.issues]
        graph.add_node(body)
        edges = []
        for node in selected:
            edge = CanvasEdge(id=f'{body.id}:{node.kind}', source=node.id, target=body.id,
                kind='business', category='input' if node.kind == 'unit_references' else 'evidence',
                label='明确输入' if node.kind == 'unit_references' else '编写依据',
                sources=[CanvasTarget(node_id=node.id, object=node.object)])
            graph.add_edge(edge)
            edges.append(edge.id)
        graph.add_view(CanvasView(id=view_id, title=f'单元 {index + 1} 的指令', parent_id='scene',
            anchor_id=body.id, members=[CanvasMember(node_id=node.id, group=node.kind)
                for node in [*selected, body]], edge_ids=edges))
    return InstructionCanvasGraph(**graph.finish().model_dump())
