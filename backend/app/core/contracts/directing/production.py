"""生产计划、审稿、Take 和剪辑使用不同类型，保持计划与观察的边界。"""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.core.contracts.directing.common import (
    Contract, Identity, MediaRange, Note, ROLES, Role, Source, Text, unique,
)


class CoverageItem(Contract):
    """单元内的一次镜头出现项，动作部分用事件 ID 明确表达。"""

    id: Identity
    shot_id: Identity
    beat_ids: list[Identity] = Field(min_length=1)
    event_ids: list[Identity]
    action_scope: Text


class ReferenceBinding(Contract):
    """本次输入的文件、用途与主体绑定，不自动跟随资产默认图。"""

    id: Identity
    file_id: Identity
    media_kind: Literal["image", "video", "audio"]
    purpose: Literal["identity", "space", "composition", "continuity", "performance", "sound"]
    participant_ids: list[Identity]
    ordinal: int = Field(ge=0)
    source: Source
    input_role: Literal["subject", "first_frame", "last_frame", "key_frame"] = "subject"

    @model_validator(mode="after")
    def media_purpose(self):
        """声音引用只接受音频，其余视觉用途不能使用音频。"""
        if self.input_role != "subject" and self.media_kind != "image":
            raise ValueError("帧参考必须是图片")
        if (self.purpose == "sound") != (self.media_kind == "audio"):
            raise ValueError("media kind does not match purpose")
        return self


class ModelCapability(Contract):
    """记录已核验范围；unknown 不能自动提升为支持。"""

    multi_shot: Literal["unknown", "supported", "unsupported"] = "unknown"
    reference_kinds: list[Literal["image", "video", "audio"]] = Field(default_factory=list)
    evidence: Source | None = None

    @model_validator(mode="after")
    def verified(self):
        """任何具体支持结论都必须有版本与来源。"""
        if (self.multi_shot != "unknown" or self.reference_kinds) and self.evidence is None:
            raise ValueError("capability claim requires evidence")
        return self


class UnitDependency(Contract):
    """前段落幅绑定历史计划身份及实际证据；未选证据只能保存待准备计划。"""

    plan_revision_id: Identity
    unit_id: Identity
    frame_id: Identity | None = None
    reference_id: Identity | None = None

    @model_validator(mode="after")
    def paired_evidence(self):
        """证据与实际输入绑定必须同时选择，避免只登记依赖却未发送参考。"""
        if (self.frame_id is None) != (self.reference_id is None):
            raise ValueError("落幅证据和参考绑定必须同时选择")
        return self


class GenerationUnit(Contract):
    """一次明确模型请求的范围，可含多镜或部分动作。"""

    id: Identity
    coverage: list[CoverageItem] = Field(min_length=1)
    references: list[ReferenceBinding]
    model_id: Identity
    duration_ms: int = Field(gt=0)
    ratio: Text
    parameters: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    capability: ModelCapability
    dependencies: list[UnitDependency] = Field(default_factory=list)

    @model_validator(mode="after")
    def identities(self):
        """出现项和素材绑定在单元内唯一，避免覆盖或顺序歧义。"""
        unique([r.id for r in self.coverage], "coverage item")
        unique([r.id for r in self.references], "reference")
        unique([r.ordinal for r in self.references], "reference ordinal")
        unique([(r.plan_revision_id, r.unit_id) for r in self.dependencies], "unit dependency")
        return self


class ProductionPlan(Contract):
    """冻结设计的生产分组，不在任务执行时隐式拆单元。"""

    design_revision_id: Identity
    units: list[GenerationUnit] = Field(min_length=1)

    @model_validator(mode="after")
    def dependencies(self):
        """单元身份唯一；跨版本依赖由存储层核对已确认来源和真实证据。"""
        unique([r.id for r in self.units], "unit")
        return self


class CompilationDecision(Contract):
    """关键决定的去向；解释不混入实际提示词。"""

    section_path: Text
    disposition: Literal["text", "reference", "equivalent", "unexpressed"]
    explanation: Text
    text_excerpt: Text | None = None
    reference_id: Identity | None = None


class Prompt(Contract):
    """精确绑定生产计划与单元的执行文本快照。"""

    plan_revision_id: Identity
    unit_id: Identity
    format_version: Text
    text: Text
    decisions: list[CompilationDecision]
    sources: list[Source] = Field(min_length=1)

    @model_validator(mode="after")
    def decision_targets(self):
        """文本映射必须真实存在，未表达决定保留说明。"""
        for decision in self.decisions:
            if decision.disposition in ("text", "equivalent"):
                if not decision.text_excerpt or decision.text_excerpt not in self.text:
                    raise ValueError("compilation excerpt is absent from prompt")
            if decision.disposition == "reference" and decision.reference_id is None:
                raise ValueError("reference decision requires reference_id")
        return self


class ReviewOccurrence(Contract):
    """固定本轮提示词里的出现项，同镜不同单元不得合并。"""

    id: Identity
    prompt_revision_id: Identity
    plan_revision_id: Identity
    unit_id: Identity
    coverage_item_id: Identity
    shot_id: Identity
    local_number: int = Field(ge=1)


class ReviewFinding(Contract):
    """岗位观察、修改建议和验收保持可追溯。"""

    observation: Text
    affected_paths: list[Text]
    suggestion: Note
    acceptance: Note


class ReviewRow(Contract):
    """一个岗位对一个出现项的检查，pending 不等于通过。"""

    role: Role
    occurrence_id: Identity
    verdict: Literal["pending", "pass", "revise"]
    rationale: Text
    findings: list[ReviewFinding]


class ReviewPacket(Contract):
    """固定审稿清单，正式审稿必须保留六乘 N 行。"""

    mode: Literal["consultation", "formal"]
    roles: list[Role] = Field(min_length=1)
    occurrences: list[ReviewOccurrence] = Field(min_length=1)
    rows: list[ReviewRow]
    context: Note

    @model_validator(mode="after")
    def coverage(self):
        """拒绝漏行、重复、旧版清单混入和提示词编号断档。"""
        unique(self.roles, "role")
        unique([o.id for o in self.occurrences], "review occurrence")
        unique([(o.prompt_revision_id, o.coverage_item_id) for o in self.occurrences], "prompt occurrence")
        pairs = [(row.role, row.occurrence_id) for row in self.rows]
        unique(pairs, "review row")
        expected = {(role, o.id) for role in self.roles for o in self.occurrences}
        if set(pairs) != expected:
            raise ValueError("review rows must exactly cover manifest")
        if self.mode == "formal" and set(self.roles) != set(ROLES):
            raise ValueError("formal review requires six roles")
        for prompt_id in {o.prompt_revision_id for o in self.occurrences}:
            numbers = sorted(o.local_number for o in self.occurrences if o.prompt_revision_id == prompt_id)
            if numbers != list(range(1, len(numbers) + 1)):
                raise ValueError("prompt occurrence numbers must be contiguous")
        return self


class ActualCoverage(Contract):
    """人为观察到的实际覆盖，毫秒区间不由预计节拍换算。"""

    id: Identity
    coverage_item_id: Identity
    media_range: MediaRange
    observation: Text
    source: Source


class TakeAnnotation(Contract):
    """素材审查与是否采用独立；保/修可保留局部。"""

    coverage: list[ActualCoverage]
    review_status: Literal["unreviewed", "reviewed"]
    verdict: Literal["pass", "retain", "repair", "discard"] | None = None
    rationale: Note
    retained_ranges: list[MediaRange]

    @model_validator(mode="after")
    def review_state(self):
        """未审不得有审片结论，已审必须有明确结论。"""
        unique([r.id for r in self.coverage], "actual coverage")
        if (self.review_status == "reviewed") != (self.verdict is not None):
            raise ValueError("review status and verdict disagree")
        return self


class DialogueCue(Contract):
    """预演中的对白落点，时间相对卡片且不代表真实声轨。"""

    dialogue_id: Identity
    offset_ms: int = Field(ge=0)


class PlannedCutItem(Contract):
    """预演项只引用设计和预计时长，没有伪造媒体区间。"""

    kind: Literal["planned"]
    id: Identity
    design_revision_id: Identity
    shot_id: Identity
    estimated_duration_ms: int = Field(gt=0)
    timeline_start_ms: int = Field(ge=0)
    preview_file_id: Identity | None = None
    dialogue_cues: list[DialogueCue] = Field(default_factory=list)

    @model_validator(mode="after")
    def cue_range(self):
        """对白落点必须在预计卡片区间内，允许同一对白安排多个落点。"""
        if any(cue.offset_ms >= self.estimated_duration_ms for cue in self.dialogue_cues):
            raise ValueError("dialogue cue must be inside planned duration")
        return self


class MediaCutItem(Contract):
    """真实素材项显式选择 Take 和源区间。"""

    kind: Literal["media"]
    id: Identity
    take_id: Identity
    media_range: MediaRange
    timeline_start_ms: int = Field(ge=0)


CutItem = Annotated[PlannedCutItem | MediaCutItem, Field(discriminator="kind")]


class SequenceCut(Contract):
    """场次单视频轨预演或粗剪，候选 Take 不自动进入这里。"""

    items: list[CutItem]

    @model_validator(mode="after")
    def timeline(self):
        """拒绝重复身份与主视频轨重叠，允许有意留出的空白。"""
        unique([r.id for r in self.items], "cut item")
        end = 0
        for item in sorted(self.items, key=lambda r: r.timeline_start_ms):
            if item.timeline_start_ms < end:
                raise ValueError("primary video track overlaps")
            duration = (item.estimated_duration_ms if item.kind == "planned" else
                        item.media_range.source_out_ms - item.media_range.source_in_ms)
            end = item.timeline_start_ms + duration
        return self
