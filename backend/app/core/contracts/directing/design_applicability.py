"""场次设计的明确适用性；字段引用仍保存在原六岗工作单。"""

from typing import Literal

from pydantic import Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, Text, unique


DesignSubjectKind = Literal[
    'direction', 'beat', 'shot', 'criterion', 'event', 'performance_beat',
    'staging_activity', 'camera', 'continuity', 'immutable_fact', 'prompt', 'sound',
    'performance', 'staging', 'situation', 'anchor', 'blocking', 'dialogue',
]


class DesignSubject(Contract):
    """用原对象 ID 与稳定字段名定位一项设计，不依赖数组顺序。"""

    kind: DesignSubjectKind
    id: Identity | None = None
    field: Identity


class DesignOccurrence(Contract):
    """单元出现项身份由单元与出现项共同确定。"""

    unit_id: Identity
    coverage_item_id: Identity


class DesignApplicability(Contract):
    """一个来源字段只声明一种范围；约束另记制作阶段和可选条件。"""

    subject: DesignSubject
    purpose: Literal['background', 'design', 'constraint']
    scope: Literal['scene', 'scene_rule', 'shots', 'occurrences']
    shot_ids: list[Identity] = Field(default_factory=list)
    occurrences: list[DesignOccurrence] = Field(default_factory=list)
    phase: Literal['video', 'sound', 'postproduction'] | None = None
    condition: Text | None = None

    @model_validator(mode='after')
    def consistent_scope(self):
        """全场规则不混入局部 ID；局部规则必须明确实际范围。"""
        unique(self.shot_ids, 'design scope shot')
        unique([(row.unit_id, row.coverage_item_id) for row in self.occurrences], 'design scope occurrence')
        if self.scope == 'scene_rule' and (self.purpose != 'constraint' or self.shot_ids or self.occurrences):
            raise ValueError('全场规则不能同时指定局部范围')
        if self.scope == 'scene' and (self.purpose != 'background' or self.shot_ids or self.occurrences):
            raise ValueError('全场背景不能同时声明动作、规则或局部范围')
        if self.scope == 'shots' and (not self.shot_ids or self.occurrences):
            raise ValueError('镜头适用范围须只列出镜头')
        if self.scope == 'occurrences' and (not self.occurrences or self.shot_ids):
            raise ValueError('出现项适用范围须只列出单元出现项')
        if self.purpose == 'constraint' and self.phase is None:
            raise ValueError('约束必须声明制作阶段')
        if self.purpose != 'constraint' and (self.phase is not None or self.condition is not None):
            raise ValueError('普通设计不能声明规则阶段或条件')
        return self


SUBJECT_FIELDS = {
    'direction': {'viewpoint', 'information_change', 'relationship_change', 'turning_point',
                  'spatial_basis', 'shootable_area', 'axis', 'scale', 'control_level'},
    'beat': {'objective', 'obstacle', 'expected_change', 'must_show'},
    'shot': {'narrative_function', 'visible_result'},
    'criterion': {'requirement'},
    'event': {'description'},
    'performance_beat': {'objective', 'obstacle', 'subtext', 'attention', 'internal_adjustment',
                         'physical_action', 'delivery', 'reaction_order', 'exit_state', 'avoid',
                         'gaze', 'breath', 'weight', 'hands', 'voice'},
    'staging_activity': {'depth', 'ongoing_task', 'path', 'attention', 'reaction_delay', 'intensity',
                         'entrances_exits', 'narrative_support', 'end_state'},
    'camera': {'composition', 'depth_layers', 'viewpoint', 'position', 'height_angle', 'lens_effect',
               'depth_focus', 'support', 'movement_start', 'movement_trigger', 'movement_path',
               'movement_speed', 'end_frame', 'light_sources', 'light_regions', 'exposure_color',
               'optical_effects', 'motion_texture', 'technical_parameters', 'adjacent_requirements',
               'prohibitions'},
    'continuity': {'before', 'change', 'after', 'following_constraint'},
    'immutable_fact': {'text'},
    'prompt': {'priorities', 'binding_requirements', 'sound_strategy', 'prohibitions'},
    'sound': {'sources', 'ambience_actions', 'music_constraints'},
    'performance': {'applicability'},
    'staging': {'environment', 'intentional_absence'},
    'situation': {'situation', 'relationship'},
    'anchor': {'description'},
    'blocking': {'position', 'orientation', 'initiative', 'path', 'transition_reason'},
    'dialogue': {'content'},
}

BACKGROUND_FIELDS = {
    'direction': {'viewpoint', 'information_change', 'relationship_change', 'turning_point',
                  'spatial_basis', 'shootable_area'},
    'beat': {'objective', 'obstacle', 'expected_change'},
    'shot': {'narrative_function'}, 'performance': {'applicability'},
    'performance_beat': {'objective', 'obstacle', 'subtext', 'attention', 'internal_adjustment'},
    'staging': {'environment', 'intentional_absence'},
    'staging_activity': {'attention', 'narrative_support'},
    'situation': {'situation', 'relationship'}, 'anchor': {'description'},
    'prompt': {'priorities'}, 'sound': {'sources', 'ambience_actions'},
}

CONSTRAINT_FIELDS = {
    'criterion': {'requirement'},
    'direction': {'spatial_basis', 'shootable_area', 'axis', 'scale', 'control_level'},
    'performance_beat': {'avoid'},
    'camera': SUBJECT_FIELDS['camera'],
    'continuity': {'before', 'after', 'following_constraint'},
    'immutable_fact': {'text'},
    'prompt': {'binding_requirements', 'sound_strategy', 'prohibitions'},
    'sound': {'music_constraints'},
    'performance': {'applicability'},
    'staging_activity': {'depth', 'intensity'},
    'blocking': {'position', 'orientation', 'initiative', 'path'},
}


def validate_design_applicability(design) -> None:
    """只解析本场原工作单的稳定身份；共享人物等引用不推断适用镜头。"""
    rows = {
        'beat': design.direction.beats, 'shot': design.direction.shots,
        'criterion': design.criteria, 'event': design.events,
        'performance_beat': design.performance.beats,
        'staging_activity': design.staging.activities, 'camera': design.cinematography,
        'continuity': design.continuity, 'immutable_fact': design.direction.immutable_facts,
        'situation': design.performance.situations, 'anchor': design.direction.anchors,
        'blocking': design.direction.blocking_states, 'dialogue': design.sound.dialogues,
    }
    singles = {'direction', 'performance', 'staging', 'prompt', 'sound'}
    keys = []
    shot_ids = {shot.id for shot in design.direction.shots}
    for item in design.applicability:
        subject = item.subject
        if subject.field not in SUBJECT_FIELDS[subject.kind]:
            raise ValueError(f'设计字段不支持适用性：{subject.kind}.{subject.field}')
        if subject.kind in singles:
            if subject.id is not None:
                raise ValueError('整张工作单字段不能指定行 ID')
        elif subject.id is None or not any(row.id == subject.id for row in rows[subject.kind]):
            raise ValueError(f'设计适用性引用不存在的 {subject.kind} 行：{subject.id}')
        if item.purpose == 'constraint' and subject.field not in CONSTRAINT_FIELDS.get(subject.kind, set()):
            raise ValueError(f'设计字段不是约束：{subject.kind}.{subject.field}')
        if item.purpose == 'background' and subject.field not in BACKGROUND_FIELDS.get(subject.kind, set()):
            raise ValueError(f'动作、可见结果或约束不能改标背景：{subject.kind}.{subject.field}')
        if item.scope == 'scene_rule' and subject.kind not in ('direction', 'immutable_fact', 'performance', 'prompt', 'sound'):
            raise ValueError('局部设计字段不能声明为全场规则')
        if item.scope == 'scene' and subject.kind not in ('direction', 'performance', 'staging', 'prompt', 'sound', 'situation', 'anchor'):
            raise ValueError('局部设计字段不能声明为全场背景')
        if not set(item.shot_ids) <= shot_ids:
            raise ValueError(f'设计适用性引用不存在的镜头：{set(item.shot_ids) - shot_ids}')
        if subject.kind == 'shot' and any(shot_id != subject.id for shot_id in item.shot_ids):
            raise ValueError('镜头字段不能适用于其他镜头')
        if subject.kind == 'camera':
            camera = next(row for row in design.cinematography if row.id == subject.id)
            if any(shot_id != camera.shot_id for shot_id in item.shot_ids):
                raise ValueError('摄影工作单不能适用于其他镜头')
        if subject.kind in ('beat', 'performance_beat'):
            beat_id = subject.id if subject.kind == 'beat' else next(
                row.beat_id for row in design.performance.beats if row.id == subject.id)
            if any(beat_id not in next(shot for shot in design.direction.shots if shot.id == shot_id).beat_ids
                   for shot_id in item.shot_ids):
                raise ValueError('节拍设计适用性与镜头覆盖不一致')
        keys.append((subject.kind, subject.id, subject.field))
    unique(keys, 'design applicability subject')
