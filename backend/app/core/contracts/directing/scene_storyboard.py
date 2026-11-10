"""场次分镜任务的语义输出与可应用的共同画布候选。"""

from typing import Literal

from pydantic import Field, PrivateAttr

from app.core.contracts.directing.common import Contract, Identity, Text
from app.core.contracts.directing.scene_objects import SceneObjectTaskRead
from app.core.contracts.generation_canvas import CanvasStoryboardMode
from app.schemas.generation_canvas import CanvasDocument


class StoryboardRequest(Contract):
    """显式创建目标画布并提交一次文本分镜。"""

    request_id: Identity
    name: str = Field(default='', max_length=255)
    text_model_id: Identity | None = None
    production_model_id: Identity | None = None
    pending_modality: Literal['image', 'video'] | None = Field(default=None, exclude_if=lambda value: value is None)
    mode: CanvasStoryboardMode = 'complete'
    basis_token: str | None = Field(default=None, min_length=64, max_length=64, exclude_if=lambda value: value is None)
    use_saved_objects: bool = Field(default=False, exclude_if=lambda value: not value)


class StoryboardBasisObject(Contract):
    """供用户核对的实际对象与参考身份，不返回项目资产目录。"""

    id: Identity
    name: str
    excerpt: str
    kind: Literal['character', 'scene', 'prop']
    asset_id: Identity | None = None
    asset_name: str | None = None
    image_file_id: Identity | None = None
    reference_unavailable: bool = False


class StoryboardBasis(Contract):
    """提交时以同一来源、准备修订及参考身份重新核对。"""

    token: str
    source_text: str
    source_changed: bool
    preparation_revision: int
    preparation_stale: bool
    object_task_active: bool
    objects: list[StoryboardBasisObject]


class StoryboardScope(Contract):
    """明确的拍摄适用声明；空镜头列表表示所属镜头或全场。"""

    shot_ids: list[Identity] = Field(default_factory=list, max_length=30)
    phase: Literal['all', 'image', 'video', 'sound', 'postproduction'] = 'all'
    condition_id: Identity | None = None
    occurrence_ids: list[Identity] = Field(default_factory=list, max_length=30)


class StoryboardDependency(Contract):
    """设计引用的是逻辑字段；组装时解析为分拆后的真实卡和用途。"""

    design_id: Identity
    field_id: Identity
    relation: Literal['context', 'anchor', 'position', 'event'] = 'context'
    candidate: bool = False


class StoryboardField(Contract):
    """设计内容、理由及原样摘录，服务端核对原文出处。"""

    state: Literal['fact', 'proposal', 'undecided', 'absent', 'not_applicable']
    purpose: Literal['background', 'design', 'constraint'] = 'design'
    text: str = Field(default='', max_length=4000)
    excerpt: str = Field(default='', max_length=4000)
    reason: str = Field(default='', max_length=1000)
    scope: StoryboardScope | None = None
    dependencies: list[StoryboardDependency] = Field(default_factory=list, max_length=20)


class StoryboardObject(Contract):
    """准备后补发现的对象，不允许模型分配真实资产或文件。"""

    id: Identity
    kind: Literal['character', 'scene', 'prop']
    name: Text = Field(max_length=255)
    excerpt: Text = Field(max_length=1500)


class StoryboardFrameTarget(Contract):
    """逻辑运镜及指定画面，不携带画布物理身份。"""

    design_id: Identity
    phase_id: Identity


class StoryboardMovementPhase(Contract):
    """运镜中的独立画面及其设计范围。"""

    id: Identity
    name: Text = Field(max_length=120)
    frame: StoryboardField


class StoryboardDesign(Contract):
    """一个逻辑设计，字段按实际适用范围映射到现有卡型。"""

    id: Identity
    card_type: str
    object_id: Identity | None = None
    adoption: Literal['model', 'dependency'] = 'model'
    fields: dict[str, StoryboardField] = Field(default_factory=dict, max_length=32)
    phases: list[StoryboardMovementPhase] = Field(default_factory=list, max_length=16)
    frame_target: StoryboardFrameTarget | None = None


class StoryboardOccurrence(Contract):
    """同一故事镜头内可独立制作的片段及实际参与、条件。"""

    id: Identity
    excerpt: Text = Field(max_length=4000)
    object_ids: list[Identity] | None = Field(default=None, max_length=50)
    condition_ids: list[Identity] = Field(default_factory=list, max_length=20)


class StoryboardProductionSegment(Contract):
    """组织能力只安排既有动作的分段时间与有效画幅。"""

    id: Identity
    excerpt: Text = Field(max_length=4000)
    seconds: int | None = Field(default=None, gt=0)
    ratio: str = Field(max_length=16)


class StoryboardOrganizedShot(Contract):
    """按原序组织一个超限或有独立出现项的镜头。"""

    id: Identity
    segments: list[StoryboardProductionSegment] = Field(min_length=2, max_length=16)


class StoryboardOrganization(Contract):
    """同一工作台文本任务按需调用的组织输出。"""

    shots: list[StoryboardOrganizedShot] = Field(min_length=1, max_length=30)


class StoryboardShot(Contract):
    """按原文顺序组织唯一的故事镜头及制作依据。"""

    id: Identity
    excerpt: Text = Field(max_length=4000)
    object_ids: list[Identity] = Field(default_factory=list, max_length=50)
    narrative_role: StoryboardField | None = None
    visible_result: StoryboardField | None = None
    estimated_duration: StoryboardField | None = None
    beat: StoryboardField | None = None
    estimated_seconds: int | None = Field(default=None, gt=0, le=600)
    condition_ids: list[Identity] = Field(default_factory=list, max_length=20)
    occurrences: list[StoryboardOccurrence] = Field(default_factory=list, max_length=16)
    frame_targets: list[StoryboardFrameTarget] = Field(default_factory=list, max_length=20)
    designs: list[StoryboardDesign] = Field(default_factory=list, max_length=30)


class SceneStoryboard(Contract):
    """临时分镜结构，只进入任务记录与确定性建卡。"""

    missed_objects: list[StoryboardObject] = Field(default_factory=list, max_length=100)
    shots: list[StoryboardShot] = Field(min_length=1, max_length=30)
    designs: list[StoryboardDesign] = Field(default_factory=list, max_length=160)
    conditions: dict[Identity, Text] = Field(default_factory=dict, max_length=40)
    _production: dict[str, list[StoryboardProductionSegment]] = PrivateAttr(default_factory=dict)

    def attach_production(self, organization: StoryboardOrganization) -> None:
        """组织结果来自同一任务内第二步验证，不能由提取响应写入。"""
        self._production = {shot.id: shot.segments for shot in organization.shots}

    def production_segments(self, shot_id: str) -> list[StoryboardProductionSegment]:
        """返回该镜头已经过校验的制作片段。"""
        return self._production.get(shot_id, [])


class StoryboardCandidate(Contract):
    """验证后的首批共同文档和目标修订，编辑仍走共同保存。"""

    base_revision: int
    document: CanvasDocument

    @classmethod
    def from_task_result(cls, result: dict) -> 'StoryboardCandidate':
        """Expose the candidate without internal review checkpoint data."""
        return cls.model_validate({key: result[key] for key in ('base_revision', 'document')})


class StoryboardRepairTarget(Contract):
    """Identify one field in a logical draft; the server determines edit eligibility."""

    shot_id: Identity | None = None
    design_id: Identity | None = None
    field_id: Identity

    @property
    def key(self) -> tuple[str | None, str | None, str]:
        """Use the complete field identity when validating the repair scope."""
        return self.shot_id, self.design_id, self.field_id


class StoryboardRepairEdit(StoryboardRepairTarget):
    """Replace proposal text only, leaving its evidence and relations intact."""

    text: Text = Field(max_length=4000)


class StoryboardRepairResult(Contract):
    """No patch may edit more than the declared fields or alter the draft shape."""

    edits: list[StoryboardRepairEdit] = Field(max_length=60)


class StoryboardReviewIssue(Contract):
    """Semantic findings cite existing draft shots and give a concrete remedy."""

    kind: Literal['conflict', 'insufficient_basis']
    shot_ids: list[Identity] = Field(min_length=1, max_length=30)
    requirements: Text = Field(max_length=1200)
    suggestion: Text = Field(max_length=1200)
    repair_targets: list[StoryboardRepairTarget] = Field(default_factory=list, max_length=60)


class StoryboardReviewReport(Contract):
    """A successful semantic inspection may still report blocking conflicts."""

    issues: list[StoryboardReviewIssue] = Field(max_length=100)

    @property
    def state(self) -> Literal['passed', 'warning', 'conflict']:
        """Derive the verdict from findings rather than trusting an independent flag."""
        if any(issue.kind == 'conflict' for issue in self.issues):
            return 'conflict'
        return 'warning' if self.issues else 'passed'


class StoryboardTaskSummary(SceneObjectTaskRead):
    """轻量任务状态，用于离开后恢复查看。"""

    canvas_id: Identity
    candidate_available: bool = False
    retry_of_task_id: Identity | None = None
    review_state: Literal['pending', 'incomplete', 'passed', 'warning', 'conflict', 'accepted', 'stale'] | None = None


class StoryboardTaskRead(StoryboardTaskSummary):
    """真实任务状态及成功后可读取的候选。"""

    pending_application: bool = False
    candidate: StoryboardCandidate | None = None
    review: StoryboardReviewReport | None = None
    accepted_conflict_ids: list[Identity] = Field(default_factory=list)


class StoryboardTargetedRepair(Contract):
    """Explicitly request a new attempt for one reviewed conflict."""

    conflict_id: Identity
    expected_revision: int = Field(ge=0)
    review_token: str = Field(min_length=64, max_length=64)
    overwrite_card_ids: list[Identity] = Field(default_factory=list, max_length=2000)


class StoryboardRetry(Contract):
    """使用失败任务的原配置，在同一目标上提交新的文本任务。"""

    request_id: Identity
    basis_token: str | None = Field(default=None, min_length=64, max_length=64)
    use_saved_objects: bool = False
    targeted_repair: StoryboardTargetedRepair | None = Field(default=None, exclude_if=lambda value: value is None)


class StoryboardRetryBasis(Contract):
    """本次重试实际可采用的依据与沿用的模型配置。"""

    canvas_id: Identity
    basis: StoryboardBasis
    source_kind: Literal['fixed', 'confirmed_scene']
    mode: CanvasStoryboardMode
    text_model_name: str
    production_model_id: Identity | None = None
    production_model_name: str | None = None
    pending_modality: Literal['image', 'video']
    review_only: bool = False


class StoryboardApplication(Contract):
    """Apply only the revision and manual choices the user reviewed."""

    expected_revision: int = Field(ge=0)
    overwrite_card_ids: list[Identity] = Field(default_factory=list, max_length=2000)
    confirmed_auto_stack_ids: list[Identity] = Field(default_factory=list, max_length=2000)
    review_token: str | None = Field(default=None, min_length=64, max_length=64)
    accepted_conflict_ids: list[Identity] = Field(default_factory=list, max_length=100)


class StoryboardDiffCard(Contract):
    """A card-level change or a preserved card with affected references."""

    id: Identity
    type: str
    type_name: str
    name: str
    manually_edited: bool = False
    lost_targets: list[str] = Field(default_factory=list)


class StoryboardDiffStack(Contract):
    """A saved stack that is affected by the exact storyboard application."""

    id: Identity
    name: str


class StoryboardConflictChoice(Contract):
    """A specific conflict and any applicable prior decision."""

    id: Identity
    issue: StoryboardReviewIssue
    previously_accepted: bool = False
    can_repair: bool = False


class StoryboardContinuityDiff(Contract):
    """Bind conflict selection to the compared design and adoption plan."""

    token: str
    stale: bool = False
    conflicts: list[StoryboardConflictChoice] = Field(default_factory=list)


class StoryboardDiff(Contract):
    """The effect of applying the task to one saved canvas revision."""

    added: list[StoryboardDiffCard]
    modified: list[StoryboardDiffCard]
    removed: list[StoryboardDiffCard]
    orphaned: list[StoryboardDiffCard]
    source_changed: bool
    automatic_stacks: list[StoryboardDiffStack] = Field(default_factory=list)
    manual_stacks: list[StoryboardDiffStack] = Field(default_factory=list)
    continuity_review: StoryboardContinuityDiff | None = None


class StoryboardReextractRequest(StoryboardRequest):
    """Extract on a known target, optionally adopting a newly confirmed scene range."""

    adopt_current_source: bool = False


class StoryboardRestore(Contract):
    """Undo or redo one reviewed application through the existing document history."""

    request_id: Identity
    expected_revision: int = Field(ge=0)
    direction: Literal['undo', 'redo']
    document: dict
