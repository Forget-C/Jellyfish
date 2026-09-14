"""六部门共享的场次设计快照；字段供后续编辑、编译、审稿共同消费。"""

from pydantic import Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, Note, Source, Text, references, unique


class Participant(Contract):
    """场次内人物或物件身份；无名参与者无需创建全局资产。"""

    id: Identity
    name: Text
    character_id: Identity | None = None
    prop_id: Identity | None = None


class Event(Contract):
    """可被表演、背景和连续性共享引用的触发事件。"""

    id: Identity
    description: Note


class Criterion(Contract):
    """可观察的验收标准，不宣称模型必然遵循。"""

    id: Identity
    requirement: Note


class Beat(Contract):
    """叙事节拍保留目标、阻碍和变化，独立于镜头拆分。"""

    id: Identity
    event_ids: list[Identity]
    objective: Note
    obstacle: Note
    expected_change: Note
    must_show: Note


class SpatialAnchor(Contract):
    """稳定空间锚点与尺度依据。"""

    id: Identity
    description: Note


class BlockingState(Contract):
    """人物调度状态以及状态改变的事件原因。"""

    id: Identity
    participant_id: Identity
    anchor_ids: list[Identity]
    event_id: Identity | None = None
    position: Note
    orientation: Note
    initiative: Note
    path: Note
    transition_reason: Note


class ShotCoverage(Contract):
    """计划镜头只表达叙事覆盖；不绑定生成任务或实际时间码。"""

    id: Identity
    beat_ids: list[Identity] = Field(min_length=1)
    event_ids: list[Identity]
    blocking_state_ids: list[Identity]
    criterion_ids: list[Identity]
    narrative_function: Note
    visible_result: Note
    estimated_duration_ms: int | None = Field(default=None, gt=0)


class Direction(Contract):
    """总导演工作单，包括叙事、空间和覆盖约束。"""

    viewpoint: Note
    information_change: Note
    relationship_change: Note
    turning_point: Note
    immutable_facts: list[Note]
    location_asset_id: Identity | None = None
    spatial_basis: Note
    shootable_area: Note
    axis: Note
    scale: Note
    open_questions: list[Note]
    control_level: Note
    beats: list[Beat] = Field(min_length=1)
    anchors: list[SpatialAnchor]
    blocking_states: list[BlockingState]
    shots: list[ShotCoverage] = Field(min_length=1)


class CharacterSituation(Contract):
    """表演前提按人物共享，不在每镜复制。"""

    participant_id: Identity
    situation: Note
    relationship: Note


class PerformanceBeat(Contract):
    """节拍与人物共同确定一行表演，保留刺激到可见行动的因果。"""

    beat_id: Identity
    participant_id: Identity
    received_event_ids: list[Identity]
    objective: Note
    obstacle: Note
    subtext: Note
    attention: Note
    internal_adjustment: Note
    physical_action: Note
    dialogue_ids: list[Identity]
    delivery: Note
    reaction_order: Note
    exit_state: Note
    avoid: Note
    criterion_ids: list[Identity]
    gaze: Note = Field(default_factory=Note)
    breath: Note = Field(default_factory=Note)
    weight: Note = Field(default_factory=Note)
    hands: Note = Field(default_factory=Note)
    voice: Note = Field(default_factory=Note)


class Performance(Contract):
    """表演部门的角色情境和节拍谱。"""

    situations: list[CharacterSituation]
    beats: list[PerformanceBeat]
    applicability: Note


class StagingActivity(Contract):
    """镜内参与者的独立任务、触发与出入画。"""

    participant_id: Identity
    anchor_id: Identity | None = None
    trigger_event_id: Identity | None = None
    depth: Note
    ongoing_task: Note
    path: Note
    attention: Note
    reaction_delay: Note
    delay_ms: int | None = Field(default=None, ge=0)
    intensity: Note
    entrances_exits: Note
    narrative_support: Note
    end_state: Note


class Staging(Contract):
    """独立镜内执行工作单；允许有理由的安静场面。"""

    activities: list[StagingActivity]
    environment: Note
    intentional_absence: Note


class CameraShot(Contract):
    """摄影意图、可见效果和技术要求，不等同于供应商参数。"""

    shot_id: Identity
    composition: Note
    depth_layers: Note
    viewpoint: Note
    position: Note
    height_angle: Note
    lens_effect: Note
    depth_focus: Note
    support: Note
    movement_start: Note
    movement_trigger: Note
    movement_path: Note
    movement_speed: Note
    end_frame: Note
    light_sources: Note
    light_regions: Note
    exposure_color: Note
    optical_effects: Note
    motion_texture: Note
    technical_parameters: Note
    adjacent_requirements: Note
    prohibitions: Note
    criterion_ids: list[Identity]


class ContinuityState(Contract):
    """计划前后态按领域分组，实际观察不回写此处。"""

    id: Identity
    domain: str = Field(pattern=r"^(space|appearance|hands_props|environment|camera|dialogue_sound)$")
    participant_id: Identity | None = None
    event_id: Identity | None = None
    before: Note
    change: Note
    after: Note
    following_constraint: Note


class Dialogue(Contract):
    """对白身份和版本为表演及声音策略的共同依据。"""

    id: Identity
    participant_id: Identity
    version: Text
    content: Note


class SoundDesign(Contract):
    """声音设计与实际制作方式分开，待后期不意味着已完成。"""

    dialogues: list[Dialogue]
    sources: Note
    ambience_actions: Note
    music_constraints: Note
    execution: str = Field(pattern=r"^(generated|postproduction|unknown)$")


class PromptDirection(Contract):
    """提示词部门的编译约束；最终文本在 PromptRevision 保存。"""

    priorities: Note
    binding_requirements: Note
    sound_strategy: Note
    prohibitions: Note


class SceneDesign(Contract):
    """一份完整六岗设计内容，局部身份仅在此版本内解析。"""

    sources: list[Source] = Field(min_length=1)
    style_revision_id: Identity | None = None
    participants: list[Participant]
    events: list[Event]
    criteria: list[Criterion]
    direction: Direction
    performance: Performance
    staging: Staging
    cinematography: list[CameraShot]
    continuity: list[ContinuityState]
    sound: SoundDesign
    prompt: PromptDirection

    @model_validator(mode="after")
    def linked_work_sheets(self):
        """逐岗解析共享身份，防止拆镜后表演丢失或跨版本错配。"""
        errors = []

        def check(validator, *args):
            """一次汇总全部身份缺口，避免模型每次只修到首个悬空引用。"""
            try:
                validator(*args)
            except ValueError as error:
                errors.append(str(error))

        groups = {"participant": self.participants, "event": self.events,
                  "criterion": self.criteria, "beat": self.direction.beats,
                  "anchor": self.direction.anchors, "blocking": self.direction.blocking_states,
                  "shot": self.direction.shots, "dialogue": self.sound.dialogues,
                  "continuity": self.continuity}
        ids = {name: [row.id for row in rows] for name, rows in groups.items()}
        for name, values in ids.items():
            check(unique, values, name)
        for beat in self.direction.beats:
            check(references, beat.event_ids, ids["event"], "event")
        for row in self.direction.blocking_states:
            check(references, [row.participant_id], ids["participant"], "participant")
            check(references, row.anchor_ids, ids["anchor"], "anchor")
            check(references, [row.event_id] if row.event_id else [], ids["event"], "event")
        for shot in self.direction.shots:
            for key, values in (("beat", shot.beat_ids), ("event", shot.event_ids),
                                ("blocking", shot.blocking_state_ids), ("criterion", shot.criterion_ids)):
                check(unique, values, key)
                check(references, values, ids[key], key)
        check(unique, [(r.beat_id, r.participant_id) for r in self.performance.beats], "performance row")
        for row in self.performance.beats:
            for key, values in (("beat", [row.beat_id]), ("participant", [row.participant_id]),
                                ("event", row.received_event_ids), ("dialogue", row.dialogue_ids),
                                ("criterion", row.criterion_ids)):
                check(references, values, ids[key], key)
        for row in self.performance.situations + self.sound.dialogues:
            check(references, [row.participant_id], ids["participant"], "participant")
        for row in self.staging.activities:
            check(references, [row.participant_id], ids["participant"], "participant")
            check(references, [row.anchor_id] if row.anchor_id else [], ids["anchor"], "anchor")
            check(references, [row.trigger_event_id] if row.trigger_event_id else [], ids["event"], "event")
        check(unique, [r.shot_id for r in self.cinematography], "camera shot")
        for row in self.cinematography:
            check(references, [row.shot_id], ids["shot"], "shot")
            check(references, row.criterion_ids, ids["criterion"], "criterion")
        for row in self.continuity:
            check(references, [row.participant_id] if row.participant_id else [], ids["participant"], "participant")
            check(references, [row.event_id] if row.event_id else [], ids["event"], "event")
        if errors:
            raise ValueError("; ".join(errors))
        return self
