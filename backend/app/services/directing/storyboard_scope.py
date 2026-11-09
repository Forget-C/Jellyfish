"""工作台将结构化设计范围落实到分卡及真实生产采用。"""

from dataclasses import dataclass, field

from app.core.contracts.directing.scene_storyboard import StoryboardDesign, StoryboardField
from app.services.generation_canvas.capabilities import parameter_diagnostics
from app.services.generation_canvas.catalog import canvas_catalog
from app.schemas.generation_canvas import CanvasModelCapability, VideoModelCard


RELATIONS = {'context': ('text', 'text'), 'anchor': ('anchor', 'anchor'),
             'position': ('anchor', 'position_anchor'), 'event': ('event', 'related_event')}
SUBJECT_PORTS = {'direction.performance': 'participant', 'direction.situation': 'participant',
                 'direction.activity': 'participant', 'direction.blocking': 'participant',
                 'direction.continuity': 'participant', 'direction.dialogue': 'speaker'}
REQUIRED_SUBJECTS = frozenset(SUBJECT_PORTS) - {'direction.continuity'}
UNIQUE_STORY_CARDS = frozenset(('direction.beat', 'direction.event', 'direction.dialogue', 'direction.criterion'))


def source_span(text: str, excerpt: str) -> tuple[int, int]:
    """原文证据必须逐字且能唯一定位。"""
    start = text.find(excerpt)
    if not excerpt or start < 0 or text.find(excerpt, start + 1) >= 0:
        raise ValueError('分镜出处必须是在本场原文可唯一定位的完整摘录')
    return start, start + len(excerpt)


@dataclass(frozen=True)
class Applicability:
    """身份集合及制作阶段仅用于组装，不改变共同画布编译规则。"""

    shots: tuple[str, ...]
    phase: str
    condition: str | None
    occurrences: tuple[str, ...]
    declared_shots: tuple[str, ...]

    def applies(self, shot: str, phase: str, conditions: set[str], occurrence: str | None = None) -> bool:
        """确定具体生产卡是否采用本片。"""
        return (shot in self.shots and self.phase in ('all', phase)
                and (self.condition is None or self.condition in conditions)
                and (not self.occurrences or occurrence in self.occurrences))

    def includes(self, dependent: 'Applicability') -> bool:
        """真实依赖须在接收片的全部适用范围内成立。"""
        return (set(dependent.shots) <= set(self.shots) and self.phase in ('all', dependent.phase)
                and self.condition in (None, dependent.condition)
                and (not self.occurrences or bool(dependent.occurrences) and set(dependent.occurrences) <= set(self.occurrences)))


@dataclass
class DesignPiece:
    """一个可独立采用的已有卡片，保留其逻辑字段和出处。"""

    key: str
    owner: str | None
    design: StoryboardDesign
    scope: Applicability
    notes: dict[str, StoryboardField] = field(default_factory=dict)


def _applicability(note, owner, design, shots, occurrences, conditions):
    explicit = note.scope
    shot_ids = explicit.shot_ids if explicit and explicit.shot_ids else [owner] if owner else list(shots)
    phase = explicit.phase if explicit else 'sound' if design.card_type == 'direction.sound' else 'all'
    condition = explicit.condition_id if explicit else None
    occurrence_ids = explicit.occurrence_ids if explicit else []
    if not set(shot_ids) <= set(shots) or len(set(shot_ids)) != len(shot_ids) or owner and shot_ids != [owner]:
        raise ValueError('设计字段引用未知镜头、重复镜头或超出所属镜头')
    if condition and condition not in conditions:
        raise ValueError('设计字段引用未声明的条件')
    if len(set(occurrence_ids)) != len(occurrence_ids) or any(occurrences.get(key) not in shot_ids for key in occurrence_ids):
        raise ValueError('设计字段引用未知或超出镜头范围的出现项')
    if occurrence_ids:
        shot_ids = [key for key in shot_ids if key in {occurrences[occurrence] for occurrence in occurrence_ids}]
    if design.object_id and any(design.object_id not in shots[key].object_ids for key in shot_ids):
        raise ValueError('设计主体未参与其声明的镜头')
    declared = tuple(key for key in shots if explicit and key in explicit.shot_ids)
    return Applicability(tuple(key for key in shots if key in shot_ids), phase, condition, tuple(sorted(occurrence_ids)), declared)


class StoryboardDesignPlan:
    """验证后拆分逻辑设计及其依赖，不复刻共享编译器。"""

    def __init__(self, result):
        shots = {shot.id: shot for shot in result.shots}
        occurrences = {item.id: shot.id for shot in result.shots for item in shot.occurrences}
        design_rows = [(None, design) for design in result.designs] + [
            (shot.id, design) for shot in result.shots for design in shot.designs]
        self.pieces = []
        self.fields = {}
        seen = set()
        for owner, design in design_rows:
            prefix = self.design_key(owner, design.id)
            if prefix in seen:
                raise ValueError('逻辑设计身份重复')
            seen.add(prefix)
            notes = {**design.fields, **{'phase:' + phase.id: phase.frame for phase in design.phases}}
            by_scope = {}
            for name, note in notes.items():
                scope = _applicability(note, owner, design, shots, occurrences, result.conditions)
                by_scope.setdefault(scope, {})[name] = note
            if design.card_type in UNIQUE_STORY_CARDS and len(by_scope) > 1:
                raise ValueError('同一节拍、事件、对白或验收身份的范围不可冲突，请拆分适用设计')
            for scope, scoped_notes in by_scope.items():
                # Range suffix depends on the scope itself so inserting another piece cannot move its identity.
                if any(note.scope for note in scoped_notes.values()):
                    suffix = repr((scope.shots, scope.phase, scope.condition, scope.occurrences, scope.declared_shots))
                    key = prefix + ':scope:' + suffix
                else:
                    key = prefix
                piece = DesignPiece(key, owner, design, scope, scoped_notes)
                self.pieces.append(piece)
                self.fields.update({(prefix, name): piece for name in scoped_notes})

    @staticmethod
    def design_key(owner, design_id):
        """全场和镜内逻辑身份分开。"""
        return f'shot:{owner}:design:{design_id}' if owner else f'scene:design:{design_id}'

    def locate(self, owner, design_id, name) -> DesignPiece:
        """同镜逻辑目标优先，后备解析全场设计。"""
        source = self.fields.get((self.design_key(owner, design_id), name))
        if source is None and owner:
            source = self.fields.get((self.design_key(None, design_id), name))
        if source is None:
            raise ValueError('设计依赖或画面目标找不到声明的字段')
        return source

    def relations(self, piece):
        """同卡多个字段可以共享一个有明确用途的关系。"""
        used = set()
        for name, note in piece.notes.items():
            for relation in note.dependencies:
                source = self.locate(piece.owner, relation.design_id, relation.field_id)
                inline = not relation.candidate and relation.relation in ('context', 'anchor')
                marker = (name if inline else None, source.key, relation.relation, relation.candidate)
                if marker not in used:
                    used.add(marker)
                    yield name, source, relation

    def frame(self, owner, target):
        """已验证的运镜分片和逻辑画面。"""
        source = self.locate(owner, target.design_id, 'phase:' + target.phase_id)
        if source.design.card_type != 'direction.movement' or not source.notes['phase:' + target.phase_id].text.strip():
            raise ValueError('画面目标须指向有内容的运镜阶段')
        return source

    def validate_relations(self, result):
        """普通编译会展开整张依赖卡，因此每个实际依赖的范围都必须兼容。"""
        policies = {(row.source_type, row.source_port, row.target_type, row.target_port): row
                    for row in canvas_catalog().connection_policies}
        dependency_graph = {}
        for piece in self.pieces:
            dependencies = set()
            for _, source, relation in self.relations(piece):
                output, target = RELATIONS[relation.relation]
                rule = policies.get((source.design.card_type, output, piece.design.card_type, target))
                if source.key == piece.key or not rule or not relation.candidate and not rule.adoption_allowed:
                    raise ValueError('设计依赖与真实卡片端点不匹配')
                if not relation.candidate and (not source.scope.includes(piece.scope)
                        or not self._allows_subject(result, source, piece)):
                    raise ValueError('设计依赖不能将其他镜头、阶段、条件或参与对象的字段带入制作')
                dependencies.add(source.key)
            if piece.design.frame_target:
                source = self.frame(piece.owner, piece.design.frame_target)
                if not source.scope.includes(piece.scope):
                    raise ValueError('构图画面目标超出适用范围')
                dependencies.add(source.key)
            dependency_graph[piece.key] = dependencies
        while dependency_graph:
            ready = {key for key, dependencies in dependency_graph.items() if not dependencies}
            if not ready:
                raise ValueError('分镜设计依赖不能形成循环')
            dependency_graph = {key: dependencies - ready for key, dependencies in dependency_graph.items() if key not in ready}
        for shot in result.shots:
            used = set()
            for target in shot.frame_targets:
                piece = self.frame(shot.id, target)
                if piece.key in used or not piece.scope.applies(shot.id, 'image', set(shot.condition_ids)):
                    raise ValueError('图片画面目标重复或不适用当前镜头')
                used.add(piece.key)

    @staticmethod
    def _allows_subject(result, source, piece):
        subject = source.design.object_id
        if not subject or subject == piece.design.object_id:
            return True
        for shot in result.shots:
            if shot.id not in piece.scope.shots:
                continue
            for occurrence in shot.occurrences:
                if piece.scope.occurrences and occurrence.id not in piece.scope.occurrences:
                    continue
                objects = occurrence.object_ids if occurrence.object_ids is not None else shot.object_ids
                if (not piece.design.object_id or piece.design.object_id in objects) and subject not in objects:
                    return False
        return True


def organization_inputs(result, args):
    """简单镜头走确定性直连，仅选定视频且确有分段需要时请求组织。"""
    capability = args.get('production_capability')
    if not capability or capability['modality'] != 'video':
        return []
    maximum = capability['max_seconds']
    return [shot.model_dump(include={'id', 'excerpt', 'estimated_seconds', 'occurrences'})
            for shot in result.shots
            if len(shot.occurrences) > 1 or maximum is not None and (shot.estimated_seconds or 0) > maximum]


def validate_organization(result, args):
    """复用共同画布参数校验，并保持冻结的完整动作覆盖和片段身份。"""
    originals = args['organization_inputs']
    if [shot.id for shot in result.shots] != [shot['id'] for shot in originals]:
        raise ValueError('生产组织必须保留待分段镜头及原始顺序')
    capability = CanvasModelCapability.model_validate(args['production_capability'])
    for shot, original in zip(result.shots, originals):
        occurrences = original['occurrences']
        segments = shot.segments
        if occurrences and [(item.id, item.excerpt) for item in segments] != [
                (item['id'], item['excerpt']) for item in occurrences]:
            raise ValueError('生产组织不能改变冻结的出现项、动作覆盖或顺序')
        if len({segment.id for segment in segments}) != len(segments):
            raise ValueError('生产分段身份不可重复')
        cursor = 0
        for segment in segments:
            position = original['excerpt'].find(segment.excerpt, cursor)
            if position < 0 or original['excerpt'][cursor:position].strip():
                raise ValueError('生产分段必须连续覆盖全部镜头原文')
            cursor = position + len(segment.excerpt)
            card = VideoModelCard(id='production', config={'ratio': segment.ratio, 'seconds': segment.seconds})
            if parameter_diagnostics(card, capability) or segment.seconds is not None and capability.max_seconds is None:
                raise ValueError('生产分段时长或画幅超出已核实模型能力')
        if original['excerpt'][cursor:].strip():
            raise ValueError('生产分段遗漏原镜头范围')
        seconds = [segment.seconds for segment in segments]
        if original['estimated_seconds'] is not None and (None in seconds or sum(seconds) != original['estimated_seconds']):
            raise ValueError('生产分段必须保留原镜头总时长')
