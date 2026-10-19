"""从单个已保存场次修订投影设计对象和字段引用。"""

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.design_applicability import DesignApplicability


class RelationshipNode(Contract):
    """对象的来源路径；历史无 ID 行仅以路径定位，不赋予持久身份。"""

    key: str
    kind: str
    path: list[str | int]
    stable: bool = True
    missing: bool = False


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


class SceneRelationshipGraph(Contract):
    """与读取的版本修订一同生成的只读关系投影。"""

    version_id: Identity
    revision: int = Field(gt=0)
    nodes: list[RelationshipNode]
    edges: list[RelationshipEdge]
    paths: list[RelationshipPath]
    applicability: list[DesignApplicability]


def scene_relationship_graph(version_id: str, revision: int, design) -> SceneRelationshipGraph:
    """只沿显式 ID 字段建立直接边，绝不从名称或共享参与者推断关系。"""
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
                       ('location', ['direction']), ('staging', ['staging']),
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
    paths = [RelationshipPath(source=first.owner, target=second.target, steps=[first, second])
             for first in edges for second in outgoing.get(first.target, [])
             if second.target != first.owner]
    return SceneRelationshipGraph(version_id=version_id, revision=revision,
                                  nodes=nodes, edges=edges, paths=paths,
                                  applicability=design.applicability)
