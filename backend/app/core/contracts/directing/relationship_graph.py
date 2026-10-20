"""从单个已保存场次修订投影设计对象、引用与展示归位。"""

from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.design_applicability import DesignApplicability, DesignOccurrence
from app.core.contracts.directing.design_scope import (
    DesignScopeIssue, design_preparation_issues, design_scope_issues, resolved_design_fields,
)


class RelationshipNode(Contract):
    """对象的来源路径；历史无 ID 行仅以路径定位，不赋予持久身份。"""

    key: str
    kind: str
    path: list[str | int]
    stable: bool = True
    missing: bool = False
    placement: Literal['scene_background', 'scene_rule', 'shots', 'occurrences',
                       'pending_shot', 'unlinked'] = 'unlinked'
    shot_ids: list[Identity] = Field(default_factory=list)
    reason: str = ''


class RelationshipEdge(Contract):
    """一条真实字段引用；owner 和 field 可定位原始编辑位置。"""

    owner: str
    field: str
    target: str
    target_id: str


class RelationshipPath(Contract):
    """间接到达只展示连续的真实字段引用，不创建可编辑边。"""

    source: str
    target: str
    steps: list[RelationshipEdge] = Field(min_length=2)


class RelationshipUse(Contract):
    """原字段或独立条目的内容用途；背景不自动变成执行要求。"""

    owner: str
    field: str
    purpose: Literal['background', 'design', 'constraint']
    scope: Literal['scene', 'scene_rule', 'shots', 'occurrences'] | None = None
    shot_ids: list[Identity] = Field(default_factory=list)
    occurrences: list[DesignOccurrence] = Field(default_factory=list)
    phase: Literal['video', 'sound', 'postproduction'] | None = None
    condition: str | None = None
    reason: str
    has_content: bool = True


class SceneRelationshipGraph(Contract):
    """与读取的版本修订一同生成的只读关系投影。"""

    version_id: Identity
    revision: int = Field(gt=0)
    nodes: list[RelationshipNode]
    edges: list[RelationshipEdge]
    paths: list[RelationshipPath]
    uses: list[RelationshipUse]
    applicability: list[DesignApplicability]
    complete: bool = False
    issues: list[DesignScopeIssue] = Field(default_factory=list)
    preparation_issues: list[DesignScopeIssue] = Field(default_factory=list)


def scene_relationship_graph(version_id: str, revision: int, content) -> SceneRelationshipGraph:
    """只沿显式 ID 字段建立直接边，绝不从名称或共享参与者推断关系。"""
    design = content.design
    nodes: list[RelationshipNode] = []
    edges: list[RelationshipEdge] = []
    known: set[str] = set()

    def add(kind, rows, path):
        for index, row in enumerate(rows):
            stable = bool(row.id)
            key = f'{kind}:{row.id if stable else index}'
            nodes.append(RelationshipNode(key=key, kind=kind, path=[*path, index], stable=stable))
            known.add(key)

    def link(owner, field, target_kind, ids):
        for target_id in ids:
            edges.append(RelationshipEdge(owner=owner, field=field,
                                          target=f'{target_kind}:{target_id}', target_id=target_id))

    add('participant', design.participants, ['participants'])
    add('event', design.events, ['events'])
    add('criterion', design.criteria, ['criteria'])
    add('fact', design.direction.immutable_facts, ['direction', 'immutable_facts'])
    for kind, rows, path in (
        ('beat', design.direction.beats, ['direction', 'beats']),
        ('anchor', design.direction.anchors, ['direction', 'anchors']),
        ('blocking', design.direction.blocking_states, ['direction', 'blocking_states']),
        ('shot', design.direction.shots, ['direction', 'shots']),
        ('situation', design.performance.situations, ['performance', 'situations']),
        ('performance', design.performance.beats, ['performance', 'beats']),
        ('activity', design.staging.activities, ['staging', 'activities']),
        ('camera', design.cinematography, ['cinematography']),
        ('continuity', design.continuity, ['continuity']),
        ('dialogue', design.sound.dialogues, ['sound', 'dialogues']),
    ):
        add(kind, rows, path)
    for kind, path in (('overview', ['direction']), ('space', ['direction']),
                       ('location', ['direction']), ('performance', ['performance']), ('staging', ['staging']),
                       ('sound', ['sound']), ('prompt', ['prompt'])):
        nodes.append(RelationshipNode(key=kind, kind=kind, path=path))
        known.add(kind)

    for row in design.direction.beats:
        link(f'beat:{row.id}', 'event_ids', 'event', row.event_ids)
    for row in design.direction.blocking_states:
        owner = f'blocking:{row.id}'
        link(owner, 'participant_id', 'participant', [row.participant_id])
        link(owner, 'anchor_ids', 'anchor', row.anchor_ids)
        link(owner, 'event_id', 'event', [row.event_id] if row.event_id else [])
    for row in design.direction.shots:
        owner = f'shot:{row.id}'
        for field, kind in (('beat_ids', 'beat'), ('event_ids', 'event'),
                            ('blocking_state_ids', 'blocking'), ('participant_ids', 'participant'),
                            ('criterion_ids', 'criterion')):
            link(owner, field, kind, getattr(row, field) or [])
    for index, row in enumerate(design.performance.situations):
        link(f'situation:{row.id or index}', 'participant_id', 'participant', [row.participant_id])
    for index, row in enumerate(design.performance.beats):
        owner = f'performance:{row.id or index}'
        for field, kind in (('beat_id', 'beat'), ('participant_id', 'participant'),
                            ('received_event_ids', 'event'), ('dialogue_ids', 'dialogue'),
                            ('criterion_ids', 'criterion')):
            value = getattr(row, field)
            link(owner, field, kind, value if isinstance(value, list) else [value])
    for index, row in enumerate(design.staging.activities):
        owner = f'activity:{row.id or index}'
        for field, kind in (('participant_id', 'participant'), ('anchor_id', 'anchor'),
                            ('trigger_event_id', 'event')):
            value = getattr(row, field)
            link(owner, field, kind, [value] if value else [])
    for index, row in enumerate(design.cinematography):
        owner = f'camera:{row.id or index}'
        link(owner, 'shot_id', 'shot', [row.shot_id])
        link(owner, 'criterion_ids', 'criterion', row.criterion_ids)
    for row in design.continuity:
        for field, kind in (('participant_id', 'participant'), ('event_id', 'event')):
            value = getattr(row, field)
            link(f'continuity:{row.id}', field, kind, [value] if value else [])
    for row in design.sound.dialogues:
        link(f'dialogue:{row.id}', 'participant_id', 'participant', [row.participant_id])
    for edge in edges:
        if edge.target not in known:
            nodes.append(RelationshipNode(key=edge.target, kind='missing', path=[], missing=True))
            known.add(edge.target)
    outgoing: dict[str, list[RelationshipEdge]] = {}
    for edge in edges:
        outgoing.setdefault(edge.owner, []).append(edge)
    paths = []
    for first in edges:
        for second in outgoing.get(first.target, []):
            if second.target == first.owner:
                continue
            paths.append(RelationshipPath(source=first.owner, target=second.target, steps=[first, second]))
            for third in outgoing.get(second.target, []):
                if third.target not in {first.owner, first.target}:
                    paths.append(RelationshipPath(source=first.owner, target=third.target,
                                                  steps=[first, second, third]))
    direct_shots: dict[str, set[str]] = {}
    for edge in edges:
        if edge.owner.startswith('shot:'):
            direct_shots.setdefault(edge.target, set()).add(edge.owner[5:])
    scoped: dict[str, list[DesignApplicability]] = {}
    subject_kinds = {'performance_beat': 'performance', 'staging_activity': 'activity',
                     'immutable_fact': 'fact'}
    for item in design.applicability:
        subject = item.subject
        key = subject_kinds.get(subject.kind, subject.kind)
        if key == 'direction':
            key = 'space' if subject.field in {'spatial_basis', 'shootable_area', 'axis', 'scale'} else 'overview'
        key = f'{key}:{subject.id}' if subject.id else key
        scoped.setdefault(key, []).append(item)
    occurrence_shots = {(unit.id, item.id): item.shot_id
                        for unit in content.units for item in unit.coverage}
    fields = resolved_design_fields(design)
    issues = design_scope_issues(design, fields)
    uses = [RelationshipUse(owner=row.owner, field=row.field, purpose=row.purpose,
                            scope=row.scope, shot_ids=row.shot_ids, occurrences=row.occurrences,
                            phase=row.phase, condition=row.condition, reason=row.reason,
                            has_content=row.has_content) for row in fields]
    for node in nodes:
        if node.kind == 'participant' or node.key == 'location':
            uses.append(RelationshipUse(owner=node.key, field='name' if node.kind == 'participant' else 'location_asset_id',
                purpose='background', scope='scene', reason='场内身份或场所依据，不表示每镜出场'))
    background_keys = {'overview', 'space', 'location', 'performance', 'staging', 'sound', 'prompt'}
    background_kinds = {'participant', 'situation', 'anchor'}
    for node in nodes:
        active = [row for row in fields if row.owner == node.key and row.has_content]
        globals_ = [row for row in active if row.scope in {'scene', 'scene_rule'}]
        locals_ = [row for row in active if row.scope in {'shots', 'occurrences'}]
        if node.missing:
            node.placement = 'pending_shot'
            node.reason = '引用目标在当前保存修订中不存在'
        elif node.kind == 'shot':
            node.placement = 'shots'
            node.shot_ids = [node.key[5:]]
        elif node.kind == 'camera':
            node.placement = 'shots'
            node.shot_ids = [design.cinematography[node.path[-1]].shot_id]
            node.reason = '摄影工作单明确归属的镜头'
        elif globals_ or not active and (node.key in background_keys or node.kind in background_kinds):
            node.placement = ('scene_rule' if globals_ and not any(row.purpose == 'background' for row in globals_)
                              else 'scene_background')
            node.shot_ids = sorted({key for row in locals_ for key in row.shot_ids})
            node.reason = ('工作单含不同用途或范围，按字段用途查看规则；背景不自动执行'
                           if locals_ or node.key in scoped else '按字段职责服务于全场；无需逐镜关联')
        elif locals_:
            node.placement = 'occurrences' if any(row.scope == 'occurrences' for row in locals_) else 'shots'
            node.shot_ids = sorted({key for row in locals_ for key in row.shot_ids} | {
                occurrence_shots[(target.unit_id, target.coverage_item_id)]
                for row in locals_ for target in row.occurrences})
            node.reason = '按字段明确归属镜头或单元出现项'
        elif any(row.scope is None for row in active):
            node.placement = 'pending_shot' if any(edge.owner == node.key or edge.target == node.key for edge in edges) else 'unlinked'
            node.reason = '设计未完整：部分内容尚未明确适用范围'
        elif scopes := scoped.get(node.key):
            if any(item.scope == 'scene_rule' for item in scopes):
                node.placement = 'scene_rule'
                node.reason = '原字段明确声明全场规则'
            elif any(item.scope == 'occurrences' for item in scopes):
                node.placement = 'occurrences'
                node.shot_ids = sorted({occurrence_shots[(target.unit_id, target.coverage_item_id)]
                                        for item in scopes for target in item.occurrences})
                node.reason = '原字段明确指定单元出现项'
            else:
                node.placement = 'shots'
                node.shot_ids = sorted({shot_id for item in scopes for shot_id in item.shot_ids})
                node.reason = '原字段明确指定镜头'
        elif node.kind in {'beat', 'event', 'blocking', 'criterion'} and node.key in direct_shots:
            node.placement = 'shots'
            node.shot_ids = sorted(direct_shots[node.key])
            node.reason = '镜头覆盖字段直接引用此对象'
        elif any(edge.owner == node.key or edge.target == node.key for edge in edges):
            node.placement = 'pending_shot'
            node.reason = '存在真实引用，但未明确适用于哪个镜头'
        else:
            node.reason = '尚无真实引用或明确适用范围'
    return SceneRelationshipGraph(version_id=version_id, revision=revision,
                                  nodes=nodes, edges=edges, paths=paths, uses=uses,
                                  applicability=design.applicability, complete=not issues, issues=issues,
                                  preparation_issues=design_preparation_issues(design, content.units, fields))
