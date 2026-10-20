"""按字段职责解析范围，供关系图、整场验收及单元投影共用。"""

from dataclasses import dataclass, field as data_field

from pydantic import Field

from app.core.contracts.directing.common import Contract, Note
from app.core.contracts.directing.design_applicability import BACKGROUND_FIELDS, SUBJECT_FIELDS, DesignOccurrence


class DesignScopeIssue(Contract):
    """缺项定位到原对象与字段；可保存不代表设计或拍摄准备完整。"""

    owner: str
    field: str
    path: list[str | int]
    reason: str
    shot_ids: list[str] = Field(default_factory=list)


@dataclass
class ResolvedDesignField:
    """保留原值及来源，不把图归位或引用数量当作字段范围。"""

    owner: str
    field: str
    path: list[str | int]
    value: Note | str
    purpose: str
    scope: str | None = None
    shot_ids: list[str] = data_field(default_factory=list)
    occurrences: list[DesignOccurrence] = data_field(default_factory=list)
    phase: str | None = None
    condition: str | None = None
    reason: str = '尚未明确字段适用范围'
    kind: str = ''

    @property
    def has_content(self) -> bool:
        """未知、不适用等状态不伪装成待执行正文。"""
        return bool(self.value.text if isinstance(self.value, Note) else self.value)


FIXED_BACKGROUND = {'direction', 'performance', 'staging', 'situation', 'anchor', 'sound', 'prompt'}
FIXED_CONSTRAINTS = {
    'direction': {'spatial_basis', 'shootable_area', 'axis', 'scale', 'control_level'},
    'immutable_fact': {'text'},
    'prompt': {'binding_requirements', 'sound_strategy', 'prohibitions'},
    'sound': {'music_constraints'},
}
LOCAL_CONSTRAINTS = {
    'criterion': {'requirement'},
    'performance_beat': {'avoid'}, 'staging_activity': {'depth', 'intensity'},
    'continuity': {'before', 'after', 'following_constraint'},
    'blocking': {'position', 'orientation', 'initiative', 'path'},
}
ACTION_FIELDS = {
    'beat': {'must_show'}, 'event': {'description'}, 'shot': {'visible_result'},
    'performance_beat': {'physical_action', 'gaze', 'breath', 'weight', 'hands', 'voice',
                         'delivery', 'reaction_order', 'exit_state'},
    'staging_activity': {'ongoing_task', 'path', 'reaction_delay', 'entrances_exits', 'end_state'},
    'continuity': {'change'}, 'dialogue': {'content'},
}


def resolved_design_fields(design) -> list[ResolvedDesignField]:
    """固定全场职责与明确镜头归属可继承；其余字段要求明确适用性。

    表演的 beat_id 是叙事组织，不代表每个覆盖该拍的镜头都拍所有行动；
    人物、触发事件与锚点仅为内容引用，不用来猜测镜头归属。
    """
    explicit = {(row.subject.kind, row.subject.id, row.subject.field): row for row in design.applicability}
    owners = {'performance_beat': 'performance', 'staging_activity': 'activity', 'immutable_fact': 'fact'}
    direct = {}
    for shot in design.direction.shots:
        for kind, ids in (('beat', shot.beat_ids), ('event', shot.event_ids),
                          ('blocking', shot.blocking_state_ids), ('criterion', shot.criterion_ids)):
            for identity in ids:
                direct.setdefault((kind, identity), []).append(shot.id)
    result = []

    def add(kind, source, path, identity=None, index=None):
        owner = owners.get(kind, kind)
        if kind == 'performance':
            owner = 'performance'
        elif identity is not None or index is not None:
            owner += f':{identity if identity is not None else index}'
        for name in sorted(SUBJECT_FIELDS[kind]):
            value = source if kind == 'immutable_fact' else getattr(source, name)
            key = ('space' if name in {'spatial_basis', 'shootable_area', 'axis', 'scale'}
                   else 'overview') if kind == 'direction' else owner
            purpose = ('constraint' if kind == 'camera' or name in FIXED_CONSTRAINTS.get(kind, set())
                       or name in LOCAL_CONSTRAINTS.get(kind, set()) else
                       'background' if name in BACKGROUND_FIELDS.get(kind, set()) else 'design')
            use = ResolvedDesignField(key, name, [*path, name], value, purpose, kind=kind)
            if purpose == 'constraint':
                use.phase = ('sound' if kind in {'sound', 'dialogue'} or name in {'voice', 'sound_strategy'}
                             else 'video')
            scope = explicit.get((kind, identity, name))
            if scope:
                use.purpose, use.scope = scope.purpose, scope.scope
                use.shot_ids, use.occurrences = scope.shot_ids, scope.occurrences
                use.phase, use.condition = scope.phase, scope.condition
                use.reason = '原字段明确声明的内容用途与适用范围'
            elif purpose == 'background' and kind in FIXED_BACKGROUND:
                use.scope, use.reason = 'scene', '按字段职责服务于全场的解释背景'
            elif name in FIXED_CONSTRAINTS.get(kind, set()):
                use.scope, use.reason = 'scene_rule', '按字段职责在全场持续生效的约束'
            else:
                ids = ([source.shot_id] if kind == 'camera' else [identity] if kind == 'shot'
                       else direct.get((kind, identity), []))
                if ids:
                    use.scope, use.shot_ids = 'shots', list(dict.fromkeys(ids))
                    use.reason = '原工作单明确镜头归属或镜头覆盖字段'
            result.append(use)

    for kind in ('direction', 'performance', 'staging', 'sound', 'prompt'):
        add(kind, getattr(design, kind), [kind])
    for kind, rows, path in (
        ('beat', design.direction.beats, ['direction', 'beats']),
        ('shot', design.direction.shots, ['direction', 'shots']),
        ('immutable_fact', design.direction.immutable_facts, ['direction', 'immutable_facts']),
        ('anchor', design.direction.anchors, ['direction', 'anchors']),
        ('blocking', design.direction.blocking_states, ['direction', 'blocking_states']),
        ('event', design.events, ['events']), ('criterion', design.criteria, ['criteria']),
        ('situation', design.performance.situations, ['performance', 'situations']),
        ('performance_beat', design.performance.beats, ['performance', 'beats']),
        ('staging_activity', design.staging.activities, ['staging', 'activities']),
        ('camera', design.cinematography, ['cinematography']),
        ('continuity', design.continuity, ['continuity']),
        ('dialogue', design.sound.dialogues, ['sound', 'dialogues']),
    ):
        for index, row in enumerate(rows):
            add(kind, row, [*path, index], row.id, index)
    return result


def design_scope_issues(design, fields=None) -> list[DesignScopeIssue]:
    """检查整场范围完整性；普通保存只返回缺项，不强制生成已完成内容。"""
    fields = resolved_design_fields(design) if fields is None else fields
    issues = [DesignScopeIssue(owner=row.owner, field=row.field, path=row.path,
                               reason='内容尚未明确服务的镜头或全场职责')
              for row in fields if row.has_content and row.scope is None]
    empty_owners = set()
    for row in fields:
        if (row.scope is None and row.owner not in empty_owners
                and not any(other.owner == row.owner and other.has_content for other in fields)):
            empty_owners.add(row.owner)
            issues.append(DesignScopeIssue(owner=row.owner, field=row.field, path=row.path,
                                          reason='保留的独立设计项尚无明确范围'))
    if not design.direction.shots:
        issues.append(DesignScopeIssue(owner='overview', field='shots', path=['direction', 'shots'],
                                      reason='尚未设计承接内容的镜头'))
    for index, shot in enumerate(design.direction.shots):
        if not shot.visible_result.text:
            issues.append(DesignScopeIssue(owner=f'shot:{shot.id}', field='visible_result',
                path=['direction', 'shots', index, 'visible_result'], shot_ids=[shot.id], reason='镜头尚无可见结果'))
        if not any(row.shot_id == shot.id for row in design.cinematography):
            issues.append(DesignScopeIssue(owner=f'shot:{shot.id}', field='cinematography',
                path=['cinematography'], shot_ids=[shot.id], reason='镜头缺少摄影工作单'))
        if shot.participant_ids is None:
            issues.append(DesignScopeIssue(owner=f'shot:{shot.id}', field='participant_ids',
                path=['direction', 'shots', index, 'participant_ids'], shot_ids=[shot.id], reason='镜头参与对象范围待核对'))
    return issues


def field_coverage_ids(row: ResolvedDesignField, unit) -> list[str]:
    """范围只能由定义或明确关系命中单元出现项。"""
    if row.scope in {'scene', 'scene_rule'}:
        return [item.id for item in unit.coverage]
    if row.scope == 'shots':
        return [item.id for item in unit.coverage if item.shot_id in row.shot_ids]
    if row.scope == 'occurrences':
        return [item.id for item in unit.coverage if any(
            target.unit_id == unit.id and target.coverage_item_id == item.id for target in row.occurrences)]
    return []


def field_selected(row: ResolvedDesignField, item) -> bool:
    """镜头覆盖与独立行动的执行选择分别核对，不把同镜关系当执行。"""
    kind, _, identity = row.owner.partition(':')
    selectors = {'beat': 'beat_ids', 'event': 'event_ids', 'performance': 'performance_action_ids',
                 'activity': 'staging_activity_ids', 'continuity': 'continuity_change_ids'}
    if kind == 'shot':
        return identity == item.shot_id
    return kind in selectors and identity in getattr(item, selectors[kind])


def design_preparation_issues(design, units, fields=None) -> list[DesignScopeIssue]:
    """检查应拍内容是否已分工，仅作为整场准备缺项，不阻断无关单元。"""
    fields = resolved_design_fields(design) if fields is None else fields
    issues = []
    for row in fields:
        if (not row.has_content or row.scope is None or row.purpose != 'design'
                or row.field not in ACTION_FIELDS.get(row.kind, set()) or row.kind == 'dialogue'):
            continue
        targets = (row.shot_ids if row.scope == 'shots' else list(dict.fromkeys(
            item.shot_id for unit in units for item in unit.coverage if item.id in field_coverage_ids(row, unit))))
        missing = [shot_id for shot_id in targets if not any(
            item.shot_id == shot_id and item.id in field_coverage_ids(row, unit) and field_selected(row, item)
            for unit in units for item in unit.coverage)]
        if missing:
            issues.append(DesignScopeIssue(owner=row.owner, field=row.field, path=row.path,
                shot_ids=missing, reason='应拍内容尚未分配负责的生产单元'))
    return issues
