"""指令生成和依据核对共用的单元设计范围。"""

from typing import Iterable

from app.core.contracts.directing.common import Note
from app.core.contracts.directing.design_scope import design_scope_issues, field_coverage_ids, field_selected, resolved_design_fields
from app.core.contracts.directing.instruction_basis import UnitScopeProjection, UnitScopeUse
from app.core.contracts.directing.scene_version import EditableGenerationUnit, EditableSceneDesign
from app.core.contracts.directing.style import StyleRule


def unit_scope(design: EditableSceneDesign, unit: EditableGenerationUnit,
               style_rules: Iterable[StyleRule] = (), *, version: int = 3) -> UnitScopeProjection:
    """只沿单元选择和显式适用性投影，保留可追溯的字段及纳入原因。"""
    if version == 1:
        from app.services.directing.instruction_inputs_v1 import unit_scope as historical_scope  # pylint: disable=import-outside-toplevel
        return historical_scope(design, unit, style_rules)
    fields = resolved_design_fields(design)
    field_map = {(row.owner, row.field): row for row in fields}
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

    def add(rows, owner, field, value, reason, *, coverage_ids=(), phase=None, condition=None,
            include_empty=False):
        source = field_map.get((owner, field))
        if rows is execution and source and source.scope is not None:
            allowed = field_coverage_ids(source, unit)
            coverage_ids = [identity for identity in coverage_ids if identity in allowed]
            if not coverage_ids:
                return
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
        # 镜头结果解释完整设计；本次必须拍摄的内容由动作范围和显式选择决定。
        # 旧快照仍按原投影核对，避免升级重算已确认的历史依据。
        add(execution if version == 2 else background, f'shot:{shot.id}', 'visible_result',
            shot.visible_result, '单元明确选择此镜头' if version == 2 else '所属镜头完整结果，仅解释背景',
            coverage_ids=[item.id], phase='video', include_empty=True)
        for key in item.beat_ids:
            beat = beats[key]
            add(execution, f'beat:{key}', 'must_show', beat.must_show, '单元出现项明确选择节拍',
                coverage_ids=[item.id], phase='video', include_empty=True)
            if beat.must_show.text is None and f'已选节拍 {key} 尚无可拍内容' not in unresolved:
                unresolved.append(f'已选节拍 {key} 尚无可拍内容')
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

    if version >= 3 and unit.organization:
        for field in ('entry_state', 'exit_state'):
            add(constraints, f'unit:{unit.id}', field, getattr(unit.organization, field),
                '当前可编辑组织状态要求（原 AI 依据单独追溯）',
                coverage_ids=[item.id for item in unit.coverage], phase='video')
        for index, requirement in enumerate(unit.organization.reference_requirements):
            add(constraints, f'unit:{unit.id}', f'reference_requirement:{index}', requirement,
                '待准备参考要求，不构成实际参考绑定',
                coverage_ids=[item.id for item in unit.coverage], phase='video')

    participants = set()
    for shot_id in sorted(shot_ids):
        shot = shots[shot_id]
        if shot.participant_ids is None:
            if design.performance.situations or any(
                    item.performance_action_ids or item.staging_activity_ids or item.continuity_change_ids
                    for item in unit.coverage if item.shot_id == shot_id):
                unresolved.append(f'镜头 {shot_id} 的参与对象范围待核对')
        else:
            participants.update(shot.participant_ids)
            for participant_id in shot.participant_ids:
                add(constraints, f'participant:{participant_id}', 'identity',
                    participants_by_id[participant_id].name, '当前镜头明确参与对象身份',
                    coverage_ids=[item.id for item in unit.coverage if item.shot_id == shot_id], phase='video')
    anchor_ids = {key for shot_id in shot_ids for state in design.direction.blocking_states
                  if state.id in shots[shot_id].blocking_state_ids for key in state.anchor_ids}
    anchor_ids.update(row.anchor_id for row in design.staging.activities if any(
        row.id in item.staging_activity_ids for item in unit.coverage) and row.anchor_id)
    for row in fields:
        if not row.has_content or row.purpose not in {'constraint', 'background'}:
            continue
        coverage_ids = field_coverage_ids(row, unit)
        if not coverage_ids:
            continue
        if row.purpose == 'background':
            if row.kind == 'beat':
                coverage_ids = [item.id for item in unit.coverage
                                if item.id in coverage_ids and field_selected(row, item)]
                if not coverage_ids:
                    continue
            if row.kind == 'sound':
                continue
            if row.kind == 'situation':
                situation = design.performance.situations[row.path[-2]]
                if situation.participant_id not in participants:
                    continue
            if row.kind == 'anchor' and row.scope == 'scene' and row.owner[7:] not in anchor_ids:
                continue
        add(constraints if row.purpose == 'constraint' else background, row.owner, row.field,
            row.value, row.reason, coverage_ids=coverage_ids, phase=row.phase, condition=row.condition)
    consumed_owners = {f'shot:{item.shot_id}' for item in unit.coverage}
    for item in unit.coverage:
        for kind, ids in (('beat', item.beat_ids), ('event', item.event_ids),
                          ('performance', item.performance_action_ids), ('activity', item.staging_activity_ids),
                          ('continuity', item.continuity_change_ids)):
            consumed_owners.update(f'{kind}:{identity}' for identity in ids)
    for issue in design_scope_issues(design, fields):
        if issue.owner in consumed_owners:
            unresolved.append(f'{issue.owner}.{issue.field}：{issue.reason}')
    for rule in style_rules:
        constraints.append(UnitScopeUse(owner=f'style:{rule.id}', field='requirement',
            text=rule.requirement, sources=rule.sources, reason='当前场次与视频模型适用的已确认项目风格',
            coverage_item_ids=[item.id for item in unit.coverage],
            phase='sound' if rule.role == 'sound' else 'video',
            condition=rule.exceptions.text or rule.exceptions.reason))
    return UnitScopeProjection(version=version, execution=execution, constraints=constraints,
                               background=background, unresolved=unresolved)


def instruction_design(design: EditableSceneDesign, unit: EditableGenerationUnit) -> EditableSceneDesign:
    """保留共享场次背景和当前镜头的工作单，不让无关镜头输入影响本单元。

    共享人物、事件、空间、场记、声音和编译约束仍是真实输入，改变时需要核对。
    镜头内节拍与调度作为该镜头上下文整体保留；执行动作仍由单元覆盖明确限定。
    """
    shot_ids = {item.shot_id for item in unit.coverage}
    shots = [shot for shot in design.direction.shots if shot.id in shot_ids]
    beat_ids = {key for shot in shots for key in shot.beat_ids}
    blocking_ids = {key for shot in shots for key in shot.blocking_state_ids}
    direction = design.direction.model_copy(update={
        'shots': shots,
        'beats': [beat for beat in design.direction.beats if beat.id in beat_ids],
        'blocking_states': [row for row in design.direction.blocking_states if row.id in blocking_ids],
    })
    performance = design.performance.model_copy(update={
        'beats': [row for row in design.performance.beats if row.beat_id in beat_ids],
    })
    occurrence_ids = {(unit.id, item.id) for item in unit.coverage}
    retained = {
        'shot': {row.id for row in shots},
        'beat': {row.id for row in direction.beats},
        'performance_beat': {row.id for row in performance.beats},
        'camera': {row.id for row in design.cinematography if row.shot_id in shot_ids},
    }
    applicability = []
    for scope in design.applicability:
        subject = scope.subject
        if subject.kind in retained and subject.id not in retained[subject.kind]:
            continue
        if scope.scope == 'shots':
            relevant = [shot_id for shot_id in scope.shot_ids if shot_id in shot_ids]
            if relevant:
                applicability.append(scope.model_copy(update={'shot_ids': relevant}))
        elif scope.scope == 'occurrences':
            relevant = [target for target in scope.occurrences
                        if (target.unit_id, target.coverage_item_id) in occurrence_ids]
            if relevant:
                applicability.append(scope.model_copy(update={'occurrences': relevant}))
        else:
            applicability.append(scope)
    return design.model_copy(update={
        'direction': direction, 'performance': performance,
        'cinematography': [row for row in design.cinematography if row.shot_id in shot_ids],
        'applicability': applicability,
    })
