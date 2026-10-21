"""持续编辑的场次方案；未完成内容与固定执行契约分别校验。"""

from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, Note, Source, Text, references, unique
from app.core.contracts.directing.design_applicability import DesignApplicability, validate_design_applicability
from app.core.contracts.directing.relationship_graph import SceneRelationshipGraph
from app.core.contracts.directing.production import GenerationUnit, ModelCapability, ReferenceBinding
from app.core.contracts.directing.scene_take import SceneTakeJudgment
from app.core.contracts.directing.scene_timeline import SceneTimeline
from app.core.contracts.directing.design import (
    Beat, BlockingState, CameraShot, ContinuityState, Criterion, DesignNote, Direction, Event,
    Participant, Performance, PromptDirection, SceneDesign, ShotCoverage,
    SoundDesign, SpatialAnchor, Staging,
)


class EditableShotCoverage(ShotCoverage):
    """人工镜头允许尚未分配节拍；已填写关联仍由工作单验证身份。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    beat_ids: list[Identity] = Field(default_factory=list)


class EditableDirection(Direction):
    """允许尚无节拍和镜头，已填写的身份及关联继续使用设计校验。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    viewpoint: Note = Field(default_factory=Note)
    information_change: Note = Field(default_factory=Note)
    relationship_change: Note = Field(default_factory=Note)
    turning_point: Note = Field(default_factory=Note)
    immutable_facts: list[DesignNote] = Field(default_factory=list)
    spatial_basis: Note = Field(default_factory=Note)
    shootable_area: Note = Field(default_factory=Note)
    axis: Note = Field(default_factory=Note)
    scale: Note = Field(default_factory=Note)
    open_questions: list[DesignNote] = Field(default_factory=list)
    control_level: Note = Field(default_factory=Note)
    beats: list[Beat] = Field(default_factory=list)
    anchors: list[SpatialAnchor] = Field(default_factory=list)
    blocking_states: list[BlockingState] = Field(default_factory=list)
    shots: list[EditableShotCoverage] = Field(default_factory=list)


class EditableSceneDesign(SceneDesign):
    """空工作单表达未填信息，不为保存构造虚假的镜头或业务完成状态。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    direction: EditableDirection = Field(default_factory=EditableDirection)
    participants: list[Participant] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    criteria: list[Criterion] = Field(default_factory=list)
    performance: Performance = Field(default_factory=lambda: Performance(
        situations=[], beats=[], applicability=Note()))
    staging: Staging = Field(default_factory=lambda: Staging(
        activities=[], environment=Note(), intentional_absence=Note()))
    cinematography: list[CameraShot] = Field(default_factory=list)
    continuity: list[ContinuityState] = Field(default_factory=list)
    sound: SoundDesign = Field(default_factory=lambda: SoundDesign(
        dialogues=[], sources=Note(), ambience_actions=Note(), music_constraints=Note(),
        execution='unknown'))
    prompt: PromptDirection = Field(default_factory=lambda: PromptDirection(
        priorities=Note(), binding_requirements=Note(), sound_strategy=Note(), prohibitions=Note()))
    applicability: list[DesignApplicability] = Field(default_factory=list)

    @model_validator(mode='after')
    def valid_applicability(self):
        """适用性只能指向当前工作单中仍存在的字段和镜头。"""
        validate_design_applicability(self)
        return self


def validate_new_design_row_ids(current: EditableSceneDesign, previous: EditableSceneDesign) -> None:
    """历史无 ID 行可保留；本次新增的独立行必须有稳定身份。"""
    for label, current_rows, old_rows in (
        ('不可改事实', current.direction.immutable_facts, previous.direction.immutable_facts),
        ('待确定问题', current.direction.open_questions, previous.direction.open_questions),
        ('角色情境', current.performance.situations, previous.performance.situations),
        ('节拍表演', current.performance.beats, previous.performance.beats),
        ('镜内活动', current.staging.activities, previous.staging.activities),
        ('摄影工作单', current.cinematography, previous.cinematography),
    ):
        if sum(row.id is None for row in current_rows) > sum(row.id is None for row in old_rows):
            raise ValueError(f'新增{label}缺少稳定身份')


class SceneVersionSource(Contract):
    """版本明确采用的原文及原始位置，章节更新不改写该依据。"""

    source: Source
    start: int | None = Field(default=None, ge=0)
    end: int | None = Field(default=None, ge=0)
    text: str

    @model_validator(mode='after')
    def chapter_excerpt(self):
        """原文依据只能是章节摘录，边界须成对且与 Unicode 字符数一致。"""
        if self.source.kind != 'chapter' or self.source.file_id or self.source.media_range:
            raise ValueError('scene basis must reference chapter text')
        if ((self.start is None) != (self.end is None)
                or self.start is not None and (self.end <= self.start or self.end - self.start != len(self.text))):
            raise ValueError('source range does not match excerpt')
        return self


class EditableCoverageItem(Contract):
    """单元出现项明确选择本次执行内容；镜头关系只提供候选。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    id: Identity
    shot_id: Identity
    beat_ids: list[Identity] = Field(default_factory=list)
    event_ids: list[Identity] = Field(default_factory=list)
    staging_activity_ids: list[Identity] = Field(default_factory=list)
    performance_action_ids: list[Identity] = Field(default_factory=list)
    continuity_change_ids: list[Identity] = Field(default_factory=list)
    action_scope: str = ''


class SceneFrameDependency(Contract):
    """按版本和单次采用声明依赖，落幅证据与实际参考必须成对绑定。"""

    version_id: Identity
    clip_id: Identity
    frame_id: Identity | None = None
    reference_id: Identity | None = None

    @model_validator(mode='after')
    def paired_evidence(self):
        """未绑定可保存；不能只登记证据而漏掉模型参考输入。"""
        if (self.frame_id is None) != (self.reference_id is None):
            raise ValueError('实际落幅证据和参考输入必须同时选择')
        return self


class UnitOrganization(Contract):
    """当前可编辑组织要求；source 仅追溯原 AI 组织依据，不声明人工改写来自模型。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    reason: Text
    entry_state: str = ''
    exit_state: str = ''
    reference_requirements: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    source: Source


class EditableUnitPreparation(GenerationUnit):
    """准备中的单元可缺模型或时长，执行前另做准备度与模型能力检查。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    organization: UnitOrganization | None = None
    scene_dependencies: list[SceneFrameDependency] = Field(default_factory=list)
    coverage: list[EditableCoverageItem] = Field(min_length=1)
    references: list[ReferenceBinding] = Field(default_factory=list)
    model_id: Identity | None = None
    duration_ms: int | None = Field(default=None, gt=0)
    capability: ModelCapability = Field(default_factory=ModelCapability)


    @model_validator(mode='after')
    def scene_dependency_identities(self):
        """同一单元不能重复声明同一次采用，参考输入也不能复用给两份落幅。"""
        unique([(link.version_id, link.clip_id) for link in self.scene_dependencies], 'scene dependency')
        unique([link.reference_id for link in self.scene_dependencies if link.reference_id], 'scene dependency reference')
        return self


class EditableGenerationUnit(EditableUnitPreparation):
    """正文与依据确认分别保存，普通编辑不自动确认新依据。"""

    instruction_basis_id: Identity | None = None
    instruction_check_task_id: Identity | None = None
    instruction: str = Field(default='', description='当前单元的可编辑指令正文；保存不代表检查通过或授权生成。')
    instruction_source: Source | None = Field(default=None, description='当前正文的人工或真实任务来源；正文改写时同步更新。')


class SceneVersionContent(Contract):
    """四画布共用的可编辑内容；按已交付能力扩展强类型字段。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    basis: SceneVersionSource
    design: EditableSceneDesign
    output_aspect_ratio: Literal['16:9', '9:16', '1:1'] = '16:9'
    units: list[EditableGenerationUnit] = Field(default_factory=list)
    take_judgments: list[SceneTakeJudgment] = Field(default_factory=list)
    timeline: SceneTimeline = Field(default_factory=SceneTimeline)

    @model_validator(mode='after')
    def unit_references(self):
        """局部身份按固定 ID 核对；设计修改不能让现有单元静默引用另一镜头。"""
        unique([unit.id for unit in self.units], 'unit')
        unique([(item.take_kind, item.take_id) for item in self.take_judgments], '素材判断')
        shots = {shot.id: shot for shot in self.design.direction.shots}
        occurrences = {(unit.id, item.id): item for unit in self.units for item in unit.coverage}
        for applicability in self.design.applicability:
            for target in applicability.occurrences:
                key = (target.unit_id, target.coverage_item_id)
                item = occurrences.get(key)
                if item is None:
                    raise ValueError(f'设计适用性引用不存在的单元出现项：{key}')
                if item.shot_id not in shots:
                    raise ValueError(f'设计适用性引用不存在的出现项镜头：{item.shot_id}')
                subject = applicability.subject
                if subject.kind == 'shot' and subject.id != item.shot_id:
                    raise ValueError('镜头设计适用性与出现项镜头不一致')
                if subject.kind == 'camera' and next(
                    row.shot_id for row in self.design.cinematography if row.id == subject.id
                ) != item.shot_id:
                    raise ValueError('摄影设计适用性与出现项镜头不一致')
                if subject.kind in ('beat', 'performance_beat'):
                    beat_id = subject.id if subject.kind == 'beat' else next(
                        row.beat_id for row in self.design.performance.beats if row.id == subject.id)
                    if beat_id not in shots[item.shot_id].beat_ids:
                        raise ValueError('节拍设计适用性与出现项节拍不一致')
                if subject.kind == 'event' and subject.id not in shots[item.shot_id].event_ids:
                    raise ValueError('事件设计适用性与出现项事件不一致')
        for unit in self.units:
            for item in unit.coverage:
                if item.shot_id not in shots:
                    raise ValueError(f'单元 {unit.id} 的覆盖 {item.id} 引用镜头 {item.shot_id}，请先处理该引用')
                references(item.beat_ids, shots[item.shot_id].beat_ids, f'单元 {unit.id} 镜头节拍')
                references(item.event_ids, shots[item.shot_id].event_ids, f'单元 {unit.id} 镜头事件')
                for field, rows, kind, subject_fields in (
                    ('staging_activity_ids', self.design.staging.activities, 'staging_activity',
                     {'ongoing_task', 'path', 'entrances_exits', 'end_state'}),
                    ('performance_action_ids', self.design.performance.beats, 'performance_beat',
                     {'physical_action', 'gaze', 'breath', 'weight', 'hands', 'voice', 'delivery', 'reaction_order'}),
                    ('continuity_change_ids', self.design.continuity, 'continuity', {'change'}),
                ):
                    selected = getattr(item, field)
                    unique(selected, f'单元 {unit.id} {field}')
                    choices = {row.id: row for row in rows if row.id}
                    references(selected, choices, f'单元 {unit.id} {field}')
                    for row_id in selected:
                        row = choices[row_id]
                        if kind == 'performance_beat' and row.beat_id not in shots[item.shot_id].beat_ids:
                            raise ValueError(f'单元 {unit.id} 的表演行动不适用于镜头 {item.shot_id}')
                        scopes = [scope for scope in self.design.applicability
                                  if scope.subject.kind == kind and scope.subject.id == row_id
                                  and scope.subject.field in subject_fields and scope.purpose == 'design']
                        if kind != 'performance_beat' and not scopes:
                            raise ValueError(f'单元 {unit.id} 的{kind}尚未声明适用范围')
                        if scopes and not any(
                            item.shot_id in scope.shot_ids if scope.scope == 'shots' else
                            any(target.unit_id == unit.id and target.coverage_item_id == item.id
                                for target in scope.occurrences) if scope.scope == 'occurrences' else False
                            for scope in scopes
                        ):
                            raise ValueError(f'单元 {unit.id} 的{kind}不适用于本次出现项')
            for binding in unit.references:
                references(binding.participant_ids, [row.id for row in self.design.participants],
                           f'单元 {unit.id} 参考 {binding.id} 参与对象')
        return self


class SceneVersionCreate(Contract):
    """只有显式创建才产生新方案，请求身份供重复提交核实。"""

    request_id: Identity
    title: str = Field(min_length=1, max_length=255, pattern=r'\S')


class SceneVersionSave(Contract):
    """保存沿用方案身份，revision 仅用于并发保护，不是可选历史版本。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    content: SceneVersionContent


class SceneVersionRead(Contract):
    """带归属与保存状态的场次版本，不向用户暴露多层草稿确认。"""

    id: Identity
    project_id: Identity
    chapter_id: Identity
    sequence_id: Identity
    title: str
    revision: int = Field(gt=0)
    source: SceneVersionSource
    content: SceneVersionContent
    relationship_graph: SceneRelationshipGraph
    copied_from_version_id: Identity | None
    last_save_request_id: Identity | None
    created_at: datetime
    updated_at: datetime
