"""指令展示复用同一快照的实际消费范围与参考证据，不再次读取版本。"""

from app.core.contracts.directing.canvas_graph import (
    CanvasEdge, CanvasMember, CanvasObject, CanvasSummaryField, CanvasTarget, CanvasView,
    InstructionCanvasGraph, InstructionCanvasNode, InstructionCanvasRecord, UnitCanvasGraph,
)
from app.services.directing.canvas_graph import CanvasReadContext, GraphAssembler


async def instruction_graph(context: CanvasReadContext, units: UnitCanvasGraph, store, sequence_id) -> InstructionCanvasGraph:
    """每单元保留完整正文、真实依据和绑定集合；根视图仅是协议根。"""
    evidence = await instruction_evidence(context, store, sequence_id)
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
                for issue in node.issues:
                    if issue.target.node_id != node.id:
                        issue.target.external = True
            graph.add_node(node)
        obj = CanvasObject(version_id=context.version_id, revision=context.revision,
            kind='instruction', id=unit.id, path=['units', index, 'instruction'])
        body = InstructionCanvasNode(id=f'instruction:{unit.id}', title='当前指令', object=obj,
            unit_id=unit.id, text=unit.instruction or '', source=unit.instruction_source,
            home_view_id=view_id, summary=[CanvasSummaryField(field='instruction', label='已保存正文',
                text=unit.instruction or '尚未填写')])
        body = body.model_copy(update=evidence[unit.id])
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


async def instruction_evidence(context, store, sequence_id):
    """在已固定的版本上读取相关记录；不调用完整版本读取或执行准备。"""
    # 延迟导入服务，避免 DirectingStore 和继承它的业务服务之间循环导入。
    from sqlalchemy import func, or_, select
    from app.models.task import Task
    from app.core.contracts.directing.instruction_basis import InstructionInputs
    from app.core.contracts.directing.scene_instruction import SceneInstructionRequest
    from app.core.contracts.directing.scene_version import EditableUnitPreparation
    from app.services.directing.instruction_inputs import instruction_design, unit_scope
    from app.services.directing.instruction_check import InstructionCheckService

    if not context.content.units:
        return {}
    unit_ids = [unit.id for unit in context.content.units]
    service = InstructionCheckService(store.db, store.project_id)
    query = service._instruction_tasks(sequence_id, context.version_id).with_only_columns(Task.id).union_all(
        service._checks(sequence_id, context.version_id).with_only_columns(Task.id))
    ranked = select(Task.id, Task.status,
        Task.input_snapshot['run_args']['task_identity'].as_string().label('identity'),
        func.row_number().over(partition_by=(Task.kind, func.coalesce(
            Task.input_snapshot['scene_instruction']['unit_id'].as_string(),
            Task.input_snapshot['instruction_check']['unit_id'].as_string())),
            order_by=(Task.created_at.desc(), Task.id.desc())).label('position')
        ).where(Task.id.in_(query), or_(
            Task.input_snapshot['scene_instruction']['unit_id'].as_string().in_(unit_ids),
            Task.input_snapshot['instruction_check']['unit_id'].as_string().in_(unit_ids))).subquery()
    bound_ids = [unit.instruction_check_task_id for unit in context.content.units if unit.instruction_check_task_id]
    identities = [unit.instruction_source.reference for unit in context.content.units
                  if unit.instruction_source and unit.instruction_source.kind == 'model']
    selected = select(ranked.c.id).where(or_(ranked.c.position == 1,
        ranked.c.status.not_in(['succeeded', 'failed', 'cancelled']),
        ranked.c.id.in_(bound_ids), ranked.c.identity.in_(identities)))
    tasks = list(await store.db.scalars(select(Task).where(Task.id.in_(selected)).order_by(
        Task.created_at.desc(), Task.id.desc())))
    evidence = {}
    for unit in context.content.units:
        rows = [task for task in tasks if task.input_snapshot.get(
            'scene_instruction' if task.kind == 'directing_instruction' else 'instruction_check', {}).get('unit_id') == unit.id]
        if unit.instruction_check_task_id and not any(task.id == unit.instruction_check_task_id for task in rows):
            rows.append(await store.scene_instruction_check_task(sequence_id, context.version_id, unit.id, unit.instruction_check_task_id))
        rules = context.style_rules.get(unit.model_id or '', [])
        current = InstructionInputs(basis=context.content.basis,
            design=instruction_design(context.content.design, unit),
            unit=EditableUnitPreparation.model_validate(unit.model_dump(exclude={
                'instruction', 'instruction_source', 'instruction_basis_id', 'instruction_check_task_id'})),
            video_model_name=context.model_names.get(unit.model_id), style_rules=rules,
            scope=unit_scope(context.content.design, unit, rules))
        previous = None
        if unit.instruction_basis_id:
            receipt = await store.instruction_basis(context.version_id, unit.id, unit.instruction_basis_id)
            previous = InstructionInputs.model_validate(receipt.inputs)
        issue = context.style_issues.get(unit.model_id or '')
        status = ('empty' if not unit.instruction.strip() else 'unbound' if previous is None else
            'unverified' if issue else 'current' if service._matches_input_snapshot(
                current, previous, context.content.design, unit) else 'changed')
        records, seen = [], set()
        for task in rows:
            kind = 'suggestion' if task.kind == 'directing_instruction' else 'check'
            args = task.input_snapshot['run_args']
            source = task.input_snapshot['scene_instruction' if kind == 'suggestion' else 'instruction_check']
            bound = (unit.instruction_check_task_id == task.id if kind == 'check' else
                bool(unit.instruction_source and unit.instruction_source.kind == 'model'
                     and unit.instruction_source.reference == args.get('task_identity')))
            active = task.status not in {'succeeded', 'failed', 'cancelled'}
            if kind in seen and not bound and not active:
                continue
            seen.add(kind)
            matches, confirmed, reason = None, False, task.error_message
            if kind == 'suggestion':
                matches = service._matches_instruction_snapshot(context.content, unit,
                    SceneInstructionRequest.model_validate(source['request']), args)
                if (not matches or args.get('video_model_name') != current.video_model_name
                        or args.get('style_rules') != [rule.model_dump(mode='json') for rule in rules]):
                    matches = False
                    reason = '本单元正文、生成依据、模型或适用风格已变化；查看固定输入后沿原流程核对'
            if kind == 'check':
                matches = unit.instruction == args['instruction'] and service._matches_input_snapshot(
                    current, InstructionInputs.model_validate(args['inputs']), context.content.design, unit)
                if not matches:
                    reason = '正文或相关依据已变化，原检查不适用于当前输入'
                elif bound and status == 'current':
                    try:
                        await store.confirmable_instruction_check(sequence_id, context.version_id, unit.id, task.id)
                        confirmed = True
                    except ValueError as error:
                        reason = str(error)
            records.append(InstructionCanvasRecord(task_id=task.id, version_id=source['version_id'],
                unit_id=unit.id, request_id=source['request']['request_id'], kind=kind,
                status=task.status, bound=bound, matches_current=matches, confirmed=confirmed, reason=reason))
        evidence[unit.id] = dict(basis_id=unit.instruction_basis_id, basis_status=status,
            evidence_issue=issue, records=records)
    return evidence
