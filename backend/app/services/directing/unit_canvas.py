"""单元画布投影：筛选只控制成员，执行范围仍来自完整单元覆盖。"""

import json

from app.core.contracts.directing.canvas_graph import (
    CanvasBasisTarget, CanvasEdge, CanvasGroup, CanvasIssue, CanvasMember, CanvasObject, CanvasSummaryField,
    CanvasReferencePreview, CanvasTarget, CanvasView, DirectorCanvasGraph, ShotBasisCanvasNode, UnitBasisCanvasNode, UnitCanvasGraph, UnitCanvasNode,
    UnitConfigCanvasNode, UnitReferencesCanvasNode,
)
from app.core.contracts.directing.design_scope import design_scope_issues
from app.services.directing.canvas_graph import CanvasReadContext, GraphAssembler, note_summary
from app.services.directing.instruction_inputs import unit_scope
from app.services.directing.unit_video_inputs import UnitVideoInputError, validated_video_media
from app.core.storage import _build_public_url


def _reference_preview(context, binding):
    """按项目可见文件登记投影地址；固定绑定保留，失效文件不被默认图替换。"""
    file = context.files.get(binding.file_id)
    status = ('unavailable' if file is None else
              'deleted' if file.deleted_at is not None or file.delete_requested_at is not None else
              'wrong_media_kind' if file.type != binding.media_kind else 'available')
    media_url, thumbnail_url, preview_issue = None, None, None
    if status == 'available':
        media_url = f'/api/v1/studio/files/{binding.file_id}/download'
        if file.thumbnail_key:
            try:
                thumbnail_url = _build_public_url(file.thumbnail_key)
            except RuntimeError:
                preview_issue = '缩略图存储尚未核实；固定文件身份保留'
        elif binding.media_kind == 'image':
            thumbnail_url = media_url
    source_status = None
    if binding.asset_origin:
        source_status = 'available' if (binding.asset_origin.kind, binding.asset_origin.id) in context.available_sources else 'unavailable'
    return CanvasReferencePreview(binding_id=binding.id, file_id=binding.file_id,
        display_name=file.name if file else '原文件不可用', status=status, source_status=source_status,
        thumbnail_url=thumbnail_url, media_url=media_url, preview_issue=preview_issue)


def _unit_basis(context, unit, index, graph, director):
    """执行内容由既有范围函数决定；导演图仅提供跨画布的来源定位地址。"""
    scope = unit_scope(context.content.design, unit, context.style_rules.get(unit.model_id or '', []))
    if style_issue := context.style_issues.get(unit.model_id or ''):
        scope.unresolved.append(style_issue)
    by_owner = {node.object.id: node for node in director.nodes}
    def source_target(owner, field):
        external = False
        if owner.startswith('coverage:'):
            source = graph.nodes.get(f'unit:{unit.id}:coverage:{owner.removeprefix("coverage:")}')
        elif owner == f'unit:{unit.id}':
            source = graph.nodes.get(f'unit:{unit.id}:organization')
        else:
            source = by_owner.get(owner)
            external = True
        if source is None:
            return None
        return CanvasTarget(node_id=source.id, object=source.object,
            field='name' if owner.startswith('participant:') and field == 'identity' else field,
            external=external)

    field_targets = []
    for section in ('execution', 'constraints', 'background'):
        for row_index, row in enumerate(getattr(scope, section)):
            source = source_target(row.owner, row.field)
            field_targets.append(CanvasBasisTarget(section=section, index=row_index,
                target=source, unavailable_reason=None if source else
                '固定来源不在当前画布；保留原字段、版本与来源供核对'))
    # 缺项沿真实设计字段或组织要求定位，不再把所有问题指向第一项动作范围。
    unresolved_targets = {
        f'{issue.owner}.{issue.field}：{issue.reason}': source_target(issue.owner, issue.field if issue.shot_ids else 'applicability')
        for issue in design_scope_issues(context.content.design)
    }
    for item in unit.coverage:
        for field, kind, owner, target_field in (
            ('beat_ids', '节拍', 'beat', 'must_show'),
            ('event_ids', '事件', 'event', 'description'),
            ('performance_action_ids', '表演行动', 'performance', 'physical_action'),
            ('staging_activity_ids', '镜内活动', 'activity', 'ongoing_task'),
            ('continuity_change_ids', '连续性变化', 'continuity', 'change'),
        ):
            for identity in getattr(item, field):
                unresolved_targets[f'已选{kind} {identity} 尚无可拍内容'] = source_target(f'{owner}:{identity}', target_field)
        unresolved_targets[f'镜头 {item.shot_id} 的参与对象范围待核对'] = source_target(f'shot:{item.shot_id}', 'participant_ids')
    if unit.organization:
        for requirement in unit.organization.reference_requirements:
            unresolved_targets['参考待绑定：' + requirement] = source_target(f'unit:{unit.id}', 'reference_requirements')
    basis_id = f'unit:{unit.id}:basis'
    obj = CanvasObject(version_id=context.version_id, revision=context.revision,
        kind='unit_basis', id=f'{unit.id}:basis', path=['units', index])
    target = CanvasTarget(node_id=basis_id, object=obj)
    return UnitBasisCanvasNode(id=basis_id, title='本单元执行依据', object=obj,
        home_view_id=f'unit:{unit.id}', unit_id=unit.id, scope=scope, field_targets=field_targets,
        summary=[CanvasSummaryField(field='scope', label='实际消费范围', text=(
            f'执行 {len(scope.execution)} 项 · 约束 {len(scope.constraints)} 项 · '
            f'背景 {len(scope.background)} 项 · 待核对 {len(scope.unresolved)} 项'))],
        issues=[CanvasIssue(code='unit-scope-unresolved', message=message, severity='warning',
                            target=unresolved_targets.get(message) or target) for message in scope.unresolved])


def unit_graph(context: CanvasReadContext, director: DirectorCanvasGraph) -> UnitCanvasGraph:
    """用同一读取快照注册全镜头、逐镜头和完整单元子图，不返回可执行授权。"""
    graph = GraphAssembler('units', context.version_id, context.revision)
    content = context.content
    shots = content.design.direction.shots
    shot_numbers = {shot.id: index + 1 for index, shot in enumerate(shots)}

    def identity(kind, key, path):
        return CanvasObject(version_id=context.version_id, revision=context.revision,
                            kind=kind, id=key, path=path)

    def field(key, label, text):
        return CanvasSummaryField(field=key, label=label, text=str(text))

    def target(node, field_id=None):
        return CanvasTarget(node_id=node.id, object=node.object, field=field_id)

    def issue(node, key, message):
        node.issues.append(CanvasIssue(code=key, message=message, severity='warning',
                                       target=target(node)))

    for index, shot in enumerate(shots):
        obj = identity('design', f'shot:{shot.id}', ['direction', 'shots', index])
        source = CanvasTarget(node_id=f'shot:{shot.id}', object=obj, external=True)
        graph.add_node(ShotBasisCanvasNode(id=f'shot:{shot.id}', title=f'镜头 {index + 1}',
            object=obj, shot_id=shot.id, number=index + 1, home_view_id=f'shot:{shot.id}', sources=[source], summary=[
                field('visible_result', '完整可见结果', note_summary(shot.visible_result)),
                field('narrative_function', '叙事作用', note_summary(shot.narrative_function)),
            ]))

    # 所有视图引用同一注册对象；同一镜头出现多次仍保持 coverage 自身身份。
    units_by_shot = {shot.id: [] for shot in shots}
    for index, unit in enumerate(content.units):
        unit_id, view_id = f'unit:{unit.id}', f'unit:{unit.id}'
        obj = identity('unit', unit.id, ['units', index])
        coverage_label = '、'.join(dict.fromkeys(
            f'镜头 {shot_numbers[item.shot_id]}' for item in unit.coverage))
        node = UnitCanvasNode(id=unit_id, title=f'单元 {index + 1}', object=obj,
            home_view_id=view_id, unit_id=unit.id, number=index + 1,
            preview_title=f'{coverage_label} — 单元 {index + 1}',
            coverage_count=len(unit.coverage), reference_count=len(unit.references),
            execution_scope_supported=len(unit.coverage) == 1,
            edit_target=CanvasTarget(node_id=unit_id, object=obj), summary=[
                field('coverage', '覆盖范围', coverage_label),
                field('references', '已绑定素材', f'{len(unit.references)} 项'),
            ])
        if len(unit.coverage) != 1:
            issue(node, 'single-coverage-required', '当前 AI 组织、指令与视频执行仅支持一个覆盖出现项；可保存和浏览完整范围')
        graph.add_node(node)
        members = [CanvasMember(node_id=unit_id, group='unit')]
        edge_ids = []

        # 本轮同步创建配置，不将闭包存储或交给异步回调。
        # pylint: disable=cell-var-from-loop
        def config(key, title, category, summary, fields, *, coverage=None):
            config_id = f'{unit_id}:{key}'
            path = ['units', index]
            if coverage:
                path.extend(['coverage', unit.coverage.index(coverage)])
            elif category == 'organization':
                path.append('organization')
            config_obj = identity('coverage' if coverage else 'unit_config',
                f'{unit.id}:{key}', path)
            card = UnitConfigCanvasNode(id=config_id, title=title, object=config_obj,
                home_view_id=view_id, unit_id=unit.id, config_kind=category,
                coverage_item_id=coverage.id if coverage else None,
                shot_id=coverage.shot_id if coverage else None, fields=fields,
                summary=summary, edit_target=CanvasTarget(node_id=config_id, object=config_obj))
            graph.add_node(card)
            members.append(CanvasMember(node_id=config_id, group='configuration'))
            edge_id = f'{unit_id}:configuration:{key}'
            graph.add_edge(CanvasEdge(id=edge_id, source=unit_id, target=config_id,
                kind='guide', label='配置'))
            edge_ids.append(edge_id)
            return card
        # pylint: enable=cell-var-from-loop

        for occurrence, item in enumerate(unit.coverage):
            shot_id = f'shot:{item.shot_id}'
            if unit.id not in units_by_shot[item.shot_id]:
                units_by_shot[item.shot_id].append(unit.id)
                members.append(CanvasMember(node_id=shot_id, presentation='reference', group='basis'))
            card = config(f'coverage:{item.id}', f'动作覆盖 {occurrence + 1}', 'coverage', [
                field('shot_id', '所属镜头', f'镜头 {shot_numbers[item.shot_id]}'),
                field('action_scope', '本次动作范围', item.action_scope or '未填写'),
                *[field(name, label, '、'.join(values) if values else '未选择') for name, label, values in (
                    ('beat_ids', '节拍', item.beat_ids), ('event_ids', '事件', item.event_ids),
                    ('staging_activity_ids', '镜内活动', item.staging_activity_ids),
                    ('performance_action_ids', '表演行动', item.performance_action_ids),
                    ('continuity_change_ids', '连续性变化', item.continuity_change_ids))],
            ], ['shot_id', 'action_scope', 'beat_ids', 'event_ids', 'staging_activity_ids',
                'performance_action_ids', 'continuity_change_ids'], coverage=item)
            if not item.action_scope.strip():
                issue(card, 'action-scope-required', '本次动作范围尚未填写')
            edge_id = f'{unit_id}:coverage:{item.id}'
            graph.add_edge(CanvasEdge(id=edge_id, source=shot_id, target=unit_id,
                kind='business', label=f'覆盖出现项 {occurrence + 1}', category='design',
                sources=[target(card, 'shot_id')]))
            edge_ids.append(edge_id)

        generation = config('generation', '生成配置', 'generation', [
            field('model_id', '视频模型', context.model_names.get(unit.model_id, '原模型不可用') if unit.model_id else '未选择'),
            field('duration_ms', '时长', f'{unit.duration_ms / 1000:g} 秒' if unit.duration_ms else '未填写'),
            field('ratio', '生成画幅', unit.ratio),
            field('parameters', '种子及额外参数', json.dumps(unit.parameters, ensure_ascii=False) if unit.parameters else '未设置'),
        ], ['model_id', 'duration_ms', 'ratio', 'parameters'])
        if not unit.model_id:
            issue(generation, 'model-required', '视频模型尚未选择')
        elif unit.model_id not in context.model_names:
            issue(generation, 'model-unavailable', '原视频模型不可用；模型能力和适用风格需重新核实')
        if not unit.duration_ms:
            issue(generation, 'duration-required', '生成时长尚未填写')
        model_input = context.model_inputs.get(unit.model_id)
        generation.reference_capabilities = model_input.reference_capabilities if model_input else None
        generation.capability_error = context.model_input_errors.get(unit.model_id)
        if generation.capability_error:
            issue(generation, 'capability-unverified', generation.capability_error)
        input_error = None
        if model_input and len(unit.coverage) == 1:
            try:
                validated_video_media(unit, model_input)
            except UnitVideoInputError as error:
                input_error = error
        organization = unit.organization
        config('organization', '组织要求', 'organization', [
            field('entry_state', '入幅要求', organization.entry_state or '未填写' if organization else '未填写'),
            field('exit_state', '出幅要求', organization.exit_state or '未填写' if organization else '未填写'),
            field('reference_requirements', '待准备参考要求', '；'.join(organization.reference_requirements) or '未填写' if organization else '未填写'),
        ], ['reason', 'entry_state', 'exit_state', 'reference_requirements'])
        dependency = config('dependencies', '前段依赖', 'dependencies', [], ['dependencies', 'scene_dependencies'])
        dependency.dependency_evidence = context.dependencies.get(unit.id, [])
        dependency_rows = {'plan': [], 'scene': []}
        for evidence in dependency.dependency_evidence:
            source_label = (f'{evidence.plan_revision_id} / {evidence.unit_id}' if evidence.kind == 'plan'
                            else f'{evidence.version_id} / {evidence.clip_id}')
            frame_label = f' · 实际帧 {evidence.frame_file_id} @ {evidence.at_ms}ms' if evidence.frame_file_id else ''
            dependency_rows[evidence.kind].append(f'{source_label} · {evidence.message}{frame_label}')
            if evidence.status != 'current':
                issue(dependency, f'dependency-{evidence.status}', evidence.message)
        dependency.summary = [
            field('dependencies', '固定计划单元', '；'.join(dependency_rows['plan']) or '未声明'),
            field('scene_dependencies', '场次采用', '；'.join(dependency_rows['scene']) or '未声明'),
        ]
        reference_id = f'{unit_id}:references'
        reference_obj = identity('reference', f'{unit.id}:references', ['units', index, 'references'])
        reference = UnitReferencesCanvasNode(id=reference_id, title='参考素材', object=reference_obj,
            home_view_id=view_id, unit_id=unit.id, binding_count=len(unit.references),
            bindings=sorted(unit.references, key=lambda binding: binding.ordinal),
            previews=[_reference_preview(context, binding) for binding in sorted(unit.references, key=lambda binding: binding.ordinal)], edit_target=CanvasTarget(node_id=reference_id, object=reference_obj),
            summary=[field('bindings', '已绑定素材', f'{len(unit.references)} 项')])
        for preview in reference.previews:
            if preview.status != 'available':
                issue(reference, f'reference-file-{preview.status}', f'固定参考 {preview.binding_id}：' + {
                    'deleted': '文件已删除', 'unavailable': '文件不可用或不属于当前项目',
                    'wrong_media_kind': '实际文件类型与绑定不一致',
                }[preview.status])
            if preview.source_status == 'unavailable':
                issue(reference, 'reference-source-unavailable', f'固定参考 {preview.binding_id} 的来源资产不可用；保留选择时来源，文件可用性单独核实')
            if preview.preview_issue:
                issue(reference, 'reference-preview-unverified', preview.preview_issue)
        if input_error and (unit.duration_ms or input_error.section != 'generation'):
            issue(generation if input_error.section == 'generation' else reference,
                  'model-input-invalid', str(input_error))
        graph.add_node(reference)
        members.append(CanvasMember(node_id=reference_id, group='references'))
        edge_id = f'{unit_id}:reference-input'
        graph.add_edge(CanvasEdge(id=edge_id, source=reference_id, target=unit_id,
            kind='business', category='input', label='真实参考输入', sources=[target(reference, 'references')]))
        edge_ids.append(edge_id)
        basis = _unit_basis(context, unit, index, graph, director)
        graph.add_node(basis)
        members.append(CanvasMember(node_id=basis.id, group='execution-basis'))
        graph.add_view(CanvasView(id=view_id, title=node.title, parent_id='scene', anchor_id=unit_id,
            members=members, edge_ids=edge_ids, groups=[
                CanvasGroup(id='configuration', label='单元配置'), CanvasGroup(id='basis', label='镜头依据'),
            ]))

    def overview(view_id, title, shot_ids):
        visible_units = {key for shot_id in shot_ids for key in units_by_shot[shot_id]}
        members = [CanvasMember(node_id=f'shot:{shot_id}', group='basis') for shot_id in shot_ids]
        for unit in content.units:
            if unit.id in visible_units:
                members.extend([
                    CanvasMember(node_id=f'unit:{unit.id}', presentation='entry',
                        group='units', entry_view_id=f'unit:{unit.id}'),
                    CanvasMember(node_id=f'unit:{unit.id}:references', group='references'),
                ])
        member_ids = {member.node_id for member in members}
        edges = [edge.id for edge in graph.edges.values() if edge.kind == 'business'
                 and edge.source in member_ids and edge.target in member_ids]
        graph.add_view(CanvasView(id=view_id, title=title,
            parent_id='scene' if view_id != 'scene' else None,
            anchor_id=members[0].node_id if members else None, members=members, edge_ids=edges,
            groups=[CanvasGroup(id='basis', label='镜头依据')]))

    overview('scene', '单元画布', list(shot_numbers))
    for shot in shots:
        overview(f'shot:{shot.id}', f'镜头 {shot_numbers[shot.id]}', [shot.id])
    return UnitCanvasGraph(**graph.finish().model_dump())
