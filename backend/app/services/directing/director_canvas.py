"""导演画布的领域投影：标题、摘要、成员、来源和预览计数来自同一保存快照。"""

from app.core.contracts.directing.canvas_graph import (
    CanvasEdge, CanvasGroup, CanvasIssue, CanvasMember, CanvasObject,
    CanvasSummaryField, CanvasTarget, CanvasView, DesignCanvasNode, DirectorCanvasGraph, MissingCanvasNode,
    SourceCanvasNode,
)
from app.core.contracts.directing.common import Note
from app.services.directing.canvas_graph import CanvasReadContext, GraphAssembler, note_summary


# 与设计编辑器使用同一领域用语；这里只提供服务端展示，不驱动动态表单。
DESIGN_LABELS = {'participants': '人物与物件',
 'events': '触发事件',
 'criteria': '验收要求',
 'direction': '总导演',
 'performance': '表演指导',
 'staging': '镜内执行',
 'cinematography': '摄影指导',
 'continuity': '场记与连续性',
 'sound': '对白与声音',
 'prompt': '提示词指导',
 'id': '标识',
 'name': '名称',
 'character_id': '关联角色',
 'prop_id': '关联道具',
 'description': '说明',
 'requirement': '验收要求',
 'viewpoint': '观察视点',
 'information_change': '本场信息变化',
 'relationship_change': '人物关系变化',
 'turning_point': '关键转折',
 'immutable_facts': '不可改事实',
 'location_asset_id': '场所资产',
 'spatial_basis': '空间依据',
 'shootable_area': '可拍区域',
 'axis': '轴线',
 'scale': '空间尺度',
 'open_questions': '待确定问题',
 'control_level': '创作控制',
 'beats': '节拍',
 'anchors': '空间锚点',
 'blocking_states': '调度状态',
 'shots': '镜头覆盖',
 'event_ids': '关联事件',
 'objective': '行动目标',
 'obstacle': '阻碍',
 'expected_change': '预期变化',
 'must_show': '必须让观众看到',
 'participant_id': '人物/物件',
 'participant_ids': '参与对象',
 'anchor_ids': '位置锚点',
 'event_id': '变化事件',
 'position': '位置',
 'orientation': '朝向',
 'initiative': '主动权',
 'path': '行动路径',
 'transition_reason': '切换原因',
 'beat_ids': '覆盖节拍',
 'blocking_state_ids': '调度依据',
 'criterion_ids': '验收依据',
 'narrative_function': '叙事作用',
 'visible_result': '可见结果',
 'estimated_duration_ms': '预计时长（毫秒）',
 'situations': '角色情境',
 'situation': '当前处境',
 'relationship': '人物关系',
 'beat_id': '所属节拍',
 'received_event_ids': '接收到的事件',
 'subtext': '潜台词',
 'attention': '注意对象',
 'internal_adjustment': '内部调整',
 'physical_action': '可见身体动作',
 'dialogue_ids': '对白依据',
 'delivery': '表达方式',
 'reaction_order': '反应先后',
 'exit_state': '离开节拍时的状态',
 'avoid': '避免的表现',
 'gaze': '目光',
 'breath': '呼吸',
 'weight': '身体重心',
 'hands': '手部',
 'voice': '声音',
 'applicability': '适用说明',
 'activities': '镜内活动',
 'anchor_id': '区域锚点',
 'trigger_event_id': '触发事件',
 'depth': '景深层次',
 'ongoing_task': '持续任务',
 'reaction_delay': '反应延迟依据',
 'delay_ms': '明确延迟（毫秒）',
 'intensity': '活动强度',
 'entrances_exits': '入出画',
 'narrative_support': '对主戏的作用',
 'end_state': '结束状态',
 'environment': '环境活动',
 'intentional_absence': '留白理由',
 'shot_id': '所属镜头',
 'composition': '构图重心',
 'depth_layers': '空间层次',
 'height_angle': '高度与角度',
 'lens_effect': '焦段或透视效果',
 'depth_focus': '景深与焦点',
 'support': '支撑方式',
 'movement_start': '运动起点',
 'movement_trigger': '运动触发',
 'movement_path': '运动路径',
 'movement_speed': '运动速度',
 'end_frame': '结束画面',
 'light_sources': '光源',
 'light_regions': '明暗区域',
 'exposure_color': '曝光与色温',
 'optical_effects': '光学效果',
 'motion_texture': '运动质感',
 'technical_parameters': '技术意图',
 'adjacent_requirements': '相邻镜头衔接',
 'prohibitions': '禁止项',
 'domain': '连续性领域',
 'before': '前态',
 'change': '变化',
 'after': '后态',
 'following_constraint': '后续约束',
 'dialogues': '对白',
 'version': '对白版本',
 'content': '内容',
 'sources': '声源',
 'ambience_actions': '环境与动作声',
 'music_constraints': '音乐约束',
 'execution': '声音执行方式',
 'priorities': '编译优先级',
 'binding_requirements': '参考绑定要求',
 'sound_strategy': '声音策略'}


def _global_nodes(context: CanvasReadContext, graph: GraphAssembler) -> None:
    """从已保存全场设计投影真实摘要；局部编辑内容不进入本快照。"""
    content = context.content
    design = content.design
    source = CanvasObject(version_id=context.version_id, revision=context.revision,
                          kind='source', id='basis', path=['basis'])
    graph.add_node(SourceCanvasNode(id='原文依据', title='原文依据', object=source,
                                   text=content.basis.text, source=content.basis.source))
    cards = [
        ('overview', '全场叙事与约束', ['direction'], design.direction,
         [('viewpoint', '观察视点'), ('information_change', '本场信息变化'), ('turning_point', '关键转折')],
         ['viewpoint', 'information_change', 'relationship_change', 'turning_point',
          'open_questions', 'control_level']),
        ('space', '空间规则', ['direction'], design.direction,
         [('spatial_basis', '空间依据'), ('shootable_area', '可拍摄区域'), ('axis', '轴线'), ('scale', '尺度')],
         ['spatial_basis', 'shootable_area', 'axis', 'scale']),
        ('performance', '表演适用规则', ['performance'], design.performance,
         [('applicability', '适用说明')], ['applicability']),
        ('staging', '环境活动与留白', ['staging'], design.staging,
         [('environment', '环境活动'), ('intentional_absence', '留白理由')],
         ['environment', 'intentional_absence']),
        ('sound', '声音安排', ['sound'], design.sound,
         [('sources', '声源'), ('ambience_actions', '环境与动作声')],
         ['sources', 'ambience_actions', 'music_constraints', 'execution']),
        ('prompt', '提示词指导', ['prompt'], design.prompt,
         [('priorities', '编译优先级'), ('prohibitions', '禁止项')],
         ['priorities', 'binding_requirements', 'sound_strategy', 'prohibitions']),
        ('location', '本场场所', ['direction'], design.direction, [], ['location_asset_id']),
    ]
    for key, title, path, row, summary_fields, fields in cards:
        relation = next(node for node in context.relationships.nodes if node.key == key)
        obj = CanvasObject(version_id=context.version_id, revision=context.revision,
                           kind='design', id=key, path=path)
        summary = [CanvasSummaryField(field=field, label=label, text=note_summary(getattr(row, field)))
                   for field, label in summary_fields]
        if key == 'location':
            summary = [CanvasSummaryField(field='location_asset_id', label='本场场所',
                text=context.location_name or (f'关联对象缺失 · {design.direction.location_asset_id}'
                    if design.direction.location_asset_id else '未关联项目场所'))]
        labels = DESIGN_LABELS | dict(summary_fields) | {
            'relationship_change': '人物关系变化', 'open_questions': '待确定问题',
            'control_level': '创作控制', 'music_constraints': '音乐约束',
            'binding_requirements': '参考绑定要求', 'sound_strategy': '声音策略',
            'shots': '镜头计划',
        }
        scope_issues = [CanvasIssue(code=issue.code,
            message=f'{labels.get(issue.field, issue.field)}：{issue.reason}', severity='warning',
            target=CanvasTarget(node_id=key, object=obj, field=issue.field))
            for issue in context.relationships.issues if issue.owner == key]
        issues = list(scope_issues)
        for field in fields:
            value = getattr(row, field)
            for index, note in enumerate(value if isinstance(value, list) else [value]):
                if isinstance(note, Note) and note.state in {'unset', 'unknown'}:
                    label = labels.get(field, field)
                    if isinstance(value, list):
                        label = f'{label} {index + 1}'
                    issues.append(CanvasIssue(code=f'note_{note.state}',
                        message=f'{label} · {note_summary(note)}', severity='info',
                        target=CanvasTarget(node_id=key, object=obj, field=field)))
        target = CanvasTarget(node_id=key, object=obj)
        scope = '设计未完整 · 查看字段缺项' if scope_issues else (
            '全场规则' if relation.placement == 'scene_rule' else '全场背景 · 无需逐镜关联')
        if not scope_issues and any(use.owner == key and use.has_content
                and use.scope in {'shots', 'occurrences'} for use in context.relationships.uses):
            scope = '全场与局部内容 · 逐项查看'
        graph.add_node(DesignCanvasNode(id=key, title=title, object=obj,
            design_kind=key, fields=fields, summary=summary, edit_target=target,
            editor_kind='direction' if key in {'overview', 'space'} else key,
            scope_label=scope, scope_reason=relation.reason, issues=issues))


def _row_summary(context, kind, row):
    """具体对象摘要显式解析设计身份，不从关系连通性推断本次执行。"""
    design = context.content.design

    def note(field):
        return note_summary(getattr(row, field))

    def person(key):
        if not key:
            return '未填写'
        return next((item.name for item in design.participants if item.id == key), f'人物引用缺失 · {key}')

    def numbered(rows, key, label):
        if not key:
            return '未填写'
        return next((f'{label} {index + 1:02d}' for index, item in enumerate(rows)
                     if item.id == key), f'{label}引用缺失 · {key}')

    if kind == 'shot':
        participants = '范围待核对' if row.participant_ids is None else (
            '、'.join(person(key) for key in row.participant_ids) or '明确无参与对象')
        values = [('visible_result', '可见结果', note('visible_result')),
                  ('narrative_function', '叙事作用', note('narrative_function')),
                  ('estimated_duration_ms', '预计时长',
                   f'{row.estimated_duration_ms / 1000:g} 秒' if row.estimated_duration_ms else '未填写'),
                  ('participant_ids', '参与对象', participants)]
    elif kind == 'camera':
        values = [('shot_id', '所属镜头', numbered(design.direction.shots, row.shot_id, '镜头')),
                  ('composition', '构图重心', note('composition')),
                  ('movement_path', '运动路径', note('movement_path')),
                  ('end_frame', '结束画面', note('end_frame'))]
    elif kind == 'performance':
        values = [('participant_id', '人物与节拍', f'{person(row.participant_id)} · '
                   f'{numbered(design.direction.beats, row.beat_id, "节拍")}'),
                  ('physical_action', '可见身体动作', note('physical_action')),
                  ('objective', '行动目标', note('objective'))]
    elif kind == 'blocking':
        values = [('participant_id', '人物／物件', person(row.participant_id)),
                  ('position', '位置与朝向', f'{note("position")} · {note("orientation")}'),
                  ('path', '行动路径', note('path'))]
    elif kind == 'situation':
        values = [('participant_id', '人物', person(row.participant_id)),
                  ('situation', '当前处境', note('situation')),
                  ('relationship', '人物关系', note('relationship'))]
    elif kind == 'activity':
        values = [('participant_id', '人物／物件', person(row.participant_id)),
                  ('ongoing_task', '持续任务', note('ongoing_task')),
                  ('depth', '景深层次', note('depth'))]
    elif kind == 'continuity':
        domain = {'hands_props': '手部与道具', 'space': '空间', 'appearance': '造型',
                  'environment': '环境', 'camera': '摄影', 'dialogue_sound': '对白与声音'}[row.domain]
        subject = person(row.participant_id) if row.participant_id else (
            numbered(design.events, row.event_id, '事件') if row.event_id else '未指定对象')
        values = [('domain', '领域与对象', f'{domain} · {subject}'),
                  ('before', '前态 → 后态', f'{note("before")} → {note("after")}'),
                  ('following_constraint', '后续约束', note('following_constraint'))]
    elif kind == 'dialogue':
        values = [('participant_id', '说话对象', person(row.participant_id)),
                  ('content', '对白内容', note('content'))]
    elif kind == 'participant':
        asset = f'关联角色 · {row.character_id}' if row.character_id else (
            f'关联道具 · {row.prop_id}' if row.prop_id else '未绑定角色或道具')
        values = [('name', '名称', row.name), ('asset', '资产绑定', asset)]
    elif kind == 'beat':
        values = [('objective', '行动目标', note('objective')),
                  ('expected_change', '预期变化', note('expected_change'))]
    elif kind == 'fact':
        values = [('text', '不可改事实', note_summary(row))]
    else:
        field = {'event': 'description', 'anchor': 'description', 'criterion': 'requirement'}[kind]
        values = [(field, DESIGN_LABELS.get(field, '说明'), note(field))]
    return [CanvasSummaryField(field=field, label=label, text=text) for field, label, text in values]


def _scope_label(context, relation):
    if any(issue.owner == relation.key for issue in context.relationships.issues):
        return '设计未完整 · 查看字段缺项'
    uses = [use for use in context.relationships.uses if use.owner == relation.key and use.has_content]
    if any(use.scope in {'scene', 'scene_rule'} for use in uses) and any(
            use.scope in {'shots', 'occurrences'} for use in uses):
        return '全场与局部内容 · 逐项查看'
    if relation.placement == 'shots':
        return f'明确适用于 {len(relation.shot_ids)} 个镜头'
    return {
        'scene_background': '全场背景 · 无需逐镜关联', 'scene_rule': '全场规则',
        'occurrences': '明确适用于单元出现项', 'pending_shot': '待归镜头 · 设计未完整',
    }.get(relation.placement, '未关联 · 设计未完整')


def director_graph(context: CanvasReadContext) -> DirectorCanvasGraph:
    """原对象只注册一次，视图引用保留实际归位、字段来源和预览数量。"""
    graph = GraphAssembler('director', context.version_id, context.revision)
    _global_nodes(context, graph)
    design = context.content.design
    relations = {node.key: node for node in context.relationships.nodes}
    registry = [
        ('shot', design.direction.shots, ['direction', 'shots'], '镜头', 'direction'),
        ('beat', design.direction.beats, ['direction', 'beats'], '节拍', 'direction'),
        ('anchor', design.direction.anchors, ['direction', 'anchors'], '锚点', 'direction'),
        ('fact', design.direction.immutable_facts, ['direction', 'immutable_facts'], '不变事实', 'direction'),
        ('blocking', design.direction.blocking_states, ['direction', 'blocking_states'], '调度', 'direction'),
        ('participant', design.participants, ['participants'], '人物 / 物件', 'participants'),
        ('event', design.events, ['events'], '事件', 'direction'),
        ('criterion', design.criteria, ['criteria'], '验收要求', 'direction'),
        ('situation', design.performance.situations, ['performance', 'situations'], '角色情境', 'performance'),
        ('performance', design.performance.beats, ['performance', 'beats'], '表演', 'performance'),
        ('activity', design.staging.activities, ['staging', 'activities'], '镜内活动', 'staging'),
        ('camera', design.cinematography, ['cinematography'], '摄影', 'cinematography'),
        ('continuity', design.continuity, ['continuity'], '连续性', 'continuity'),
        ('dialogue', design.sound.dialogues, ['sound', 'dialogues'], '对白', 'sound'),
    ]
    for kind, rows, path, label, editor_kind in registry:
        for index, row in enumerate(rows):
            key = f'{kind}:{row.id or index}'
            relation = relations[key]
            # 无持久身份的显示 ID 明确带 revision，布局不会误归另一修订的同数组下标。
            node_id = key if relation.stable else f'{key}:r{context.revision}'
            obj = CanvasObject(version_id=context.version_id, revision=context.revision,
                kind='design', id=key, stable=relation.stable, path=[*path, index])
            fields = [field for field in type(row).model_fields if field != 'id']
            text = getattr(row, 'name', '')
            if not text:
                text = next((value.text for field in ['visible_result', 'objective', 'description',
                    'requirement', 'content', 'physical_action', 'ongoing_task', 'position', 'after', 'situation']
                    if isinstance(value := getattr(row, field, None), Note) and value.text), '')
            title = f'{label} {index + 1:02d}' + (f' · {text}' if text else '')
            issues = [CanvasIssue(code=issue.code, message=issue.reason, severity='warning',
                target=CanvasTarget(node_id=node_id, object=obj, field=issue.field))
                for issue in context.relationships.issues if issue.owner == key]
            for field in fields:
                value = getattr(row, field)
                if isinstance(value, Note) and value.state in {'unset', 'unknown'}:
                    issues.append(CanvasIssue(code=f'note_{value.state}',
                        message=f'{DESIGN_LABELS.get(field, field)} · {note_summary(value)}', severity='info',
                        target=CanvasTarget(node_id=node_id, object=obj, field=field)))
            graph.add_node(DesignCanvasNode(id=node_id, title=title, object=obj,
                design_kind=kind, editor_kind=editor_kind, record_id=row.id, number=index + 1,
                fields=fields, summary=_row_summary(context, kind, row), issues=issues,
                edit_target=CanvasTarget(node_id=node_id, object=obj),
                scope_label=_scope_label(context, relation), scope_reason=relation.reason))
    by_key = {node.object.id: node for node in graph.nodes.values()}
    for relation in context.relationships.nodes:
        if relation.key in by_key:
            continue
        if not relation.missing:
            raise ValueError(f'unsupported director graph object: {relation.key}')
        obj = CanvasObject(version_id=context.version_id, revision=context.revision,
                           kind='design', id=relation.key, stable=relation.stable, path=relation.path)
        target = CanvasTarget(node_id=relation.key, object=obj)
        node = MissingCanvasNode(id=relation.key, title=f'缺失引用 · {relation.key}', object=obj,
            reference_id=relation.key, reason=relation.reason,
            issues=[CanvasIssue(code='missing_reference', message=relation.reason or '引用对象不可用',
                                severity='warning', target=target)])
        graph.add_node(node)
        by_key[relation.key] = node

    def location(key):
        relation = relations[key]
        if relation.placement in {'scene_background', 'scene_rule'}:
            return 'global'
        if relation.placement in {'pending_shot', 'unlinked'}:
            return 'unlinked'
        if len(relation.shot_ids) > 1:
            return 'shared'
        return relation.shot_ids[0] if relation.shot_ids else 'unlinked'

    for key, node in by_key.items():
        if node.kind == 'source':
            continue
        home = location(key)
        node.home_view_id = 'scene' if home in {'global', 'shared', 'unlinked'} else f'shot:{home}'
        if node.kind == 'design':
            node.scope_label = _scope_label(context, relations[key])

    for edge in context.relationships.edges:
        owner, target = by_key[edge.owner], by_key[edge.target]
        source = CanvasTarget(node_id=owner.id, object=owner.object, field=edge.field)
        graph.add_edge(CanvasEdge(id=f'{edge.owner}|{edge.field}|{edge.target}',
            source=owner.id, target=target.id, kind='business',
            label=DESIGN_LABELS.get(edge.field, edge.field), sources=[source],
            category='criterion' if relations[edge.target].kind == 'criterion' else (
                'design' if relations[edge.owner].kind in {'camera', 'blocking', 'performance', 'continuity'}
                else 'evidence')))
        if target.kind == 'missing':
            target.sources.append(source)

    root_members = [CanvasMember(node_id='原文依据', group='basis')]
    for key, node in by_key.items():
        if node.kind == 'source':
            continue
        home = location(key)
        if relations[key].kind == 'shot':
            root_members.append(CanvasMember(node_id=node.id, group='scene-entry',
                presentation='entry', entry_view_id=f'shot:{node.record_id}',
                title=f'聚合子图 · 镜头 {node.number:02d}'))
        elif home in {'global', 'shared', 'unlinked'}:
            root_members.append(CanvasMember(node_id=node.id, group=f'scene-{home}'))
    root_ids = {member.node_id for member in root_members}
    for member in root_members:
        if member.presentation == 'entry':
            graph.add_edge(CanvasEdge(id=f'guide:{member.node_id}', source='原文依据',
                                     target=member.node_id, kind='guide', label='镜头入口'))
    if any(member.group == 'scene-global' for member in root_members):
        graph.add_edge(CanvasEdge(id='guide:global', source='原文依据', target_group='scene-global',
                                 kind='guide', label='全场内容'))
    root_edges = [edge.id for edge in graph.edges.values() if edge.source in root_ids
                  and (edge.target in root_ids or edge.target_group == 'scene-global')]
    graph.add_view(CanvasView(id='scene', title='场次总览', anchor_id='原文依据',
        members=root_members, edge_ids=root_edges, groups=[
            CanvasGroup(id='scene-global', label='全场内容'), CanvasGroup(id='scene-shared', label='跨镜共享'),
            CanvasGroup(id='scene-unlinked', label='未关联设计')]))
    for shot in design.direction.shots:
        owned = {key for key in relations if location(key) == shot.id}
        references = {key for edge in context.relationships.edges
            if edge.owner in owned or edge.target in owned for key in (edge.owner, edge.target)
            if location(key) == 'shared' or relations[key].missing}
        members = []
        for key in [*owned, *(references - owned)]:
            node = by_key[key]
            reference = key in references and key not in owned
            group = 'shot-shared' if reference else 'shot-center' if key == f'shot:{shot.id}' else (
                'shot-evidence' if relations[key].kind in {'beat', 'blocking', 'anchor'} else
                'shot-left' if relations[key].kind in {'participant', 'event', 'criterion'} else 'shot-work')
            members.append(CanvasMember(node_id=node.id, group=group,
                presentation='reference' if reference else 'card',
                title=f'共享引用 · {node.title}' if reference else None))
        # 业务列表按原工作单顺序；集合只用于范围判断，不能影响稳定视图顺序。
        order = {node.id: index for index, node in enumerate(graph.nodes.values())}
        members.sort(key=lambda member, lookup=order: lookup[member.node_id])
        visible = {member.node_id for member in members}
        graph.add_view(CanvasView(id=f'shot:{shot.id}', title=f'镜头 {design.direction.shots.index(shot) + 1:02d} 子图',
            parent_id='scene', anchor_id=by_key[f'shot:{shot.id}'].id, members=members,
            edge_ids=[edge.id for edge in graph.edges.values() if edge.kind == 'business'
                      and edge.source in visible and edge.target in visible],
            groups=[CanvasGroup(id='shot-evidence', label='节拍、调度与空间'),
                    CanvasGroup(id='shot-left', label='场景要素与依据'),
                    CanvasGroup(id='shot-work', label='岗位设计'),
                    CanvasGroup(id='shot-shared', label='共享引用')]))
    return DirectorCanvasGraph(**graph.finish().model_dump(), shot_count=len(context.content.design.direction.shots),
        pending_count=sum(node.placement == 'pending_shot' for node in relations.values()),
        unlinked_count=sum(node.placement == 'unlinked' for node in relations.values()))
