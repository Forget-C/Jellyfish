"""版本 1 冻结投影，仅用于按原规则核对历史指令建议和依据。"""

from typing import Iterable

from app.core.contracts.directing.common import Note
from app.core.contracts.directing.unit_scope import UnitScopeProjection, UnitScopeUse
from app.core.contracts.directing.scene_version import EditableGenerationUnit, EditableSceneDesign
from app.core.contracts.directing.style import StyleRule


def unit_scope(design: EditableSceneDesign, unit: EditableGenerationUnit,
               style_rules: Iterable[StyleRule] = ()) -> UnitScopeProjection:
    """只沿单元选择和显式适用性投影，保留可追溯的字段及纳入原因。"""
    execution: list[UnitScopeUse] = []
    constraints: list[UnitScopeUse] = []
    background: list[UnitScopeUse] = []
    unresolved: list[str] = []
    shots = {row.id: row for row in design.direction.shots}
    beats = {row.id: row for row in design.direction.beats}
    events = {row.id: row for row in design.events}
    actions = {row.id: row for row in design.performance.beats if row.id}
    activities = {row.id: row for row in design.staging.activities if row.id}
    continuity = {row.id: row for row in design.continuity}
    participants_by_id = {row.id: row for row in design.participants}
    shot_ids = {item.shot_id for item in unit.coverage}
    occurrence_ids = {(unit.id, item.id) for item in unit.coverage}

    def add(rows, owner, field, value, reason, *, coverage_ids=(), phase=None, condition=None,
            include_empty=False):
        if isinstance(value, Note):
            if value.text is None and not include_empty:
                return
            text, sources = value.text or '', value.sources
        elif isinstance(value, str):
            if not value.strip() and not include_empty:
                return
            text, sources = value, []
        else:
            return
        use = UnitScopeUse(owner=owner, field=field, text=text, sources=sources,
                           reason=reason, coverage_item_ids=list(coverage_ids),
                           phase=phase, condition=condition)
        existing = next((row for row in rows if (row.owner, row.field, row.reason)
                         == (owner, field, reason)), None)
        if existing is None:
            rows.append(use)
        else:
            existing.coverage_item_ids = list(dict.fromkeys([*existing.coverage_item_ids, *coverage_ids]))

    for item in unit.coverage:
        shot = shots[item.shot_id]
        add(execution, f'coverage:{item.id}', 'action_scope', item.action_scope, '单元出现项明确填写',
            coverage_ids=[item.id], phase='video')
        add(execution, f'shot:{shot.id}', 'visible_result', shot.visible_result, '单元明确选择此镜头',
            coverage_ids=[item.id], phase='video', include_empty=True)
        for key in item.beat_ids:
            beat = beats[key]
            add(execution, f'beat:{key}', 'must_show', beat.must_show, '单元出现项明确选择节拍',
                coverage_ids=[item.id], phase='video', include_empty=True)
            if beat.must_show.text is None and f'已选节拍 {key} 尚无可拍内容' not in unresolved:
                unresolved.append(f'已选节拍 {key} 尚无可拍内容')
            for field in ('objective', 'obstacle', 'expected_change'):
                add(background, f'beat:{key}', field, getattr(beat, field), '已选节拍的解释依据')
        for key in item.event_ids:
            add(execution, f'event:{key}', 'description', events[key].description,
                '单元出现项明确选择事件', coverage_ids=[item.id], phase='video', include_empty=True)
            if events[key].description.text is None and f'已选事件 {key} 尚无可拍内容' not in unresolved:
                unresolved.append(f'已选事件 {key} 尚无可拍内容')
        for key in item.performance_action_ids:
            row = actions[key]
            for field in ('physical_action', 'gaze', 'breath', 'weight', 'hands', 'voice',
                          'delivery', 'reaction_order', 'exit_state'):
                add(execution, f'performance:{key}', field, getattr(row, field),
                    '单元出现项明确选择表演行动', coverage_ids=[item.id], phase='video')
            if not any(use.owner == f'performance:{key}' and use.text for use in execution):
                add(execution, f'performance:{key}', 'physical_action', row.physical_action,
                    '已选表演行动待填写', coverage_ids=[item.id], phase='video', include_empty=True)
                if f'已选表演行动 {key} 尚无可拍内容' not in unresolved:
                    unresolved.append(f'已选表演行动 {key} 尚无可拍内容')
        for key in item.staging_activity_ids:
            row = activities[key]
            for field in ('ongoing_task', 'path', 'reaction_delay', 'entrances_exits', 'end_state'):
                add(execution, f'activity:{key}', field, getattr(row, field),
                    '单元出现项明确选择镜内活动', coverage_ids=[item.id], phase='video')
            if not any(use.owner == f'activity:{key}' and use.text for use in execution):
                add(execution, f'activity:{key}', 'ongoing_task', row.ongoing_task,
                    '已选镜内活动待填写', coverage_ids=[item.id], phase='video', include_empty=True)
                if f'已选镜内活动 {key} 尚无可拍内容' not in unresolved:
                    unresolved.append(f'已选镜内活动 {key} 尚无可拍内容')
        for key in item.continuity_change_ids:
            add(execution, f'continuity:{key}', 'change', continuity[key].change,
                '单元出现项明确选择可见连续性变化', coverage_ids=[item.id],
                phase='video', include_empty=True)
            if continuity[key].change.text is None:
                if f'已选连续性变化 {key} 尚无可拍内容' not in unresolved:
                    unresolved.append(f'已选连续性变化 {key} 尚无可拍内容')

    direction_owners = {'viewpoint': 'overview', 'information_change': 'overview',
                        'relationship_change': 'overview', 'turning_point': 'overview',
                        'spatial_basis': 'space', 'shootable_area': 'space',
                        'axis': 'space', 'scale': 'space', 'control_level': 'overview'}
    grouped = {
        'beat': (design.direction.beats, 'beat'),
        'shot': (design.direction.shots, 'shot'),
        'criterion': (design.criteria, 'criterion'),
        'event': (design.events, 'event'),
        'performance_beat': (design.performance.beats, 'performance'),
        'staging_activity': (design.staging.activities, 'activity'),
        'camera': (design.cinematography, 'camera'),
        'continuity': (design.continuity, 'continuity'),
        'immutable_fact': (design.direction.immutable_facts, 'fact'),
    }
    for scope in design.applicability:
        if scope.purpose != 'constraint':
            continue
        if scope.scope == 'shots' and not shot_ids.intersection(scope.shot_ids):
            continue
        if scope.scope == 'occurrences' and not any(
            (target.unit_id, target.coverage_item_id) in occurrence_ids for target in scope.occurrences
        ):
            continue
        subject = scope.subject
        if subject.kind == 'direction':
            owner, source = direction_owners[subject.field], design.direction
        elif subject.kind in ('prompt', 'sound'):
            owner, source = subject.kind, getattr(design, subject.kind)
        elif subject.kind in grouped:
            rows, kind = grouped[subject.kind]
            source = next(row for row in rows if row.id == subject.id)
            owner = f'{kind}:{subject.id}'
        else:
            # 新约束不属于旧投影语义，要求重新核对而不是改写历史或返回异常。
            unresolved.append(f'新增约束 {subject.kind}.{subject.field} 需要重新确认依据')
            continue
        value = source if subject.kind == 'immutable_fact' else getattr(source, subject.field)
        reason = {'scene_rule': '字段明确声明全场生效', 'shots': '字段明确适用于本单元镜头',
                  'occurrences': '字段明确适用于本单元出现项'}[scope.scope]
        coverage_ids = ([item.id for item in unit.coverage] if scope.scope == 'scene_rule' else
                        [item.id for item in unit.coverage if item.shot_id in scope.shot_ids]
                        if scope.scope == 'shots' else
                        [item.id for item in unit.coverage if any(
                            target.unit_id == unit.id and target.coverage_item_id == item.id
                            for target in scope.occurrences)])
        add(constraints, owner, subject.field, value, reason,
            coverage_ids=coverage_ids, phase=scope.phase, condition=scope.condition)

    constrained_direction = {use.field for use in constraints if use.owner in {'overview', 'space'}}
    for field in ('viewpoint', 'information_change', 'relationship_change', 'turning_point'):
        if field not in constrained_direction:
            add(background, 'overview', field, getattr(design.direction, field), '场次级叙事依据')
    for field in ('spatial_basis', 'shootable_area'):
        if field not in constrained_direction:
            add(background, 'space', field, getattr(design.direction, field), '场次级空间依据')
    for field in ('environment', 'intentional_absence'):
        add(background, 'staging', field, getattr(design.staging, field), '场次级环境依据')
    participants = set()
    for shot_id in shot_ids:
        shot = shots[shot_id]
        add(background, f'shot:{shot_id}', 'narrative_function', shot.narrative_function,
            '当前镜头的叙事依据')
        if shot.participant_ids is None:
            selected = [item for item in unit.coverage if item.shot_id == shot_id]
            if (design.performance.situations or any(
                    item.performance_action_ids or item.staging_activity_ids or any(
                        continuity[key].participant_id for key in item.continuity_change_ids)
                    for item in selected)):
                unresolved.append(f'镜头 {shot_id} 的参与对象范围待核对')
        else:
            participants.update(shot.participant_ids)
            for participant_id in shot.participant_ids:
                add(constraints, f'participant:{participant_id}', 'identity',
                    participants_by_id[participant_id].name, '当前镜头明确参与对象身份',
                    coverage_ids=[item.id for item in unit.coverage if item.shot_id == shot_id],
                    phase='video')
    for row in design.performance.situations:
        if row.participant_id in participants:
            for field in ('situation', 'relationship'):
                add(background, f'situation:{row.id}', field, getattr(row, field),
                    '当前镜头明确参与对象的情境')
    for rule in style_rules:
        constraints.append(UnitScopeUse(owner=f'style:{rule.id}', field='requirement',
            text=rule.requirement, sources=rule.sources, reason='当前场次与视频模型适用的已确认项目风格',
            coverage_item_ids=[item.id for item in unit.coverage],
            phase='sound' if rule.role == 'sound' else 'video',
            condition=rule.exceptions.text or rule.exceptions.reason))
    return UnitScopeProjection(execution=execution, constraints=constraints,
                               background=background, unresolved=unresolved)
