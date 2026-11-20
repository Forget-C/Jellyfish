"""场次验收、最小返工与经验候选的版本化契约，判断必须有来源。"""
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, MediaRange, Note, Role, Text, unique
from app.core.contracts.directing.revisions import RevisionSnapshot


class ObservedRange(Contract):
    """明确指向源素材的真实区间，不按计划时长推断。"""

    take_id: Identity
    media_range: MediaRange


class CutIssue(Contract):
    """区分必须修复、可优化与后期事项，并保留证据及验收条件。"""

    id: Identity
    severity: Literal['required', 'optional', 'postproduction']
    observation: Note
    evidence: list[ObservedRange] = Field(default_factory=list)
    acceptance: Note


class CutReview(Contract):
    """整场审片固定剪辑版本；画面通过不代表声音已经完成。"""

    cut_revision_id: Identity
    verdict: Literal['pass', 'revise']
    overall: Note
    established: Note
    missing_coverage: Note
    usable_ranges: list[ObservedRange]
    awaiting_evidence: Note
    sound_status: Literal['pending_postproduction', 'reviewed', 'not_applicable']
    sound_observation: Note
    issues: list[CutIssue]

    @model_validator(mode='after')
    def judgement(self):
        """必修或缺失覆盖不能同时宣称场次通过。"""
        unique([item.id for item in self.issues], 'cut issue')
        if not self.overall.sources or not self.overall.text:
            raise ValueError('整体判断必须填写内容和来源')
        if self.verdict == 'pass' and (any(item.severity == 'required' for item in self.issues)
                or self.missing_coverage.state not in ('none', 'not_applicable')):
            raise ValueError('存在必修或未确认的覆盖缺口，不能验收通过')
        if self.sound_status != 'pending_postproduction' and not (self.sound_observation.text or self.sound_observation.reason):
            raise ValueError('声音审查或不适用须填写依据')
        return self


class RepairItem(Contract):
    """固定旧片段与保留范围，关联局部修法、新计划及结果比较。"""

    cut_revision_id: Identity
    item_id: Identity
    problem_range: MediaRange
    symptom: Note
    root_cause_hypothesis: Note
    retained_ranges: list[ObservedRange]
    preferred_fix: Literal['trim', 'replace', 'reshoot', 'design', 'postproduction']
    alternative_fix: Note
    needs_new_media: bool
    primary_change: Note
    acceptance: Note
    result_plan_revision_id: Identity | None = None
    result_unit_id: Identity | None = None
    result_take_id: Identity | None = None
    result_range: MediaRange | None = None
    result_cut_revision_id: Identity | None = None
    comparison: Note = Field(default_factory=Note)
    attribution: Literal['unproven', 'single_variable', 'multiple_variables'] = 'unproven'

    @model_validator(mode='after')
    def evidence(self):
        """诊断与修法须有来源；结果区间与素材身份成对存在。"""
        for note in (self.symptom, self.root_cause_hypothesis, self.primary_change, self.acceptance):
            if not note.text or not note.sources:
                raise ValueError('返工症状、假设、主要调整及验收须有内容和来源')
        if (self.result_plan_revision_id is None) != (self.result_unit_id is None):
            raise ValueError('返工计划和单元必须同时选择')
        if (self.result_take_id is None) != (self.result_range is None):
            raise ValueError('结果素材和真实区间必须同时选择')
        # Pydantic 在校验前已将 default_factory 字段解析为 Note。
        if self.attribution != 'unproven' and (self.result_take_id is None or not self.comparison.text or not self.comparison.sources):  # pylint: disable=no-member
            raise ValueError('归因比较必须有实际结果和来源')
        return self


class KnowledgeCandidate(Contract):
    """P 原则、O 操作条件、C 项目设定仅为分类，不赋予全局效力。"""

    category: Literal['P', 'O', 'C']
    role: Role
    claim: Note
    conditions: Text
    recommendation: Text
    counterexamples: Note
    exceptions: Note
    confidence: Literal['tentative', 'supported', 'contradicted']
    review_on: Annotated[str, Field(pattern=r'^\d{4}-\d{2}-\d{2}$')]
    evidence_revision_ids: list[Identity] = Field(default_factory=list)
    evidence_take_ids: list[Identity] = Field(default_factory=list)

    @model_validator(mode='after')
    def provenance(self):
        """经验主张需要可核验来源，日期必须真实存在。"""
        from datetime import date
        date.fromisoformat(self.review_on)
        unique(self.evidence_revision_ids, 'knowledge evidence revision')
        unique(self.evidence_take_ids, 'knowledge evidence take')
        if not self.claim.text or not self.claim.sources:
            raise ValueError('经验主张必须有内容和来源')
        return self


class CutReviewDocument(Contract):
    """强类型场次验收写入。"""

    kind: Literal['cut_review']
    content: CutReview


class RepairDocument(Contract):
    """强类型返工写入。"""

    kind: Literal['repair']
    content: RepairItem


class KnowledgeDocument(Contract):
    """强类型经验候选写入。"""

    kind: Literal['knowledge']
    content: KnowledgeCandidate


class FeedbackWrite(Contract):
    """复用已确认版本派生与草稿 CAS，不另设可变台账。"""

    document: Annotated[CutReviewDocument | RepairDocument | KnowledgeDocument, Field(discriminator='kind')]
    revision_id: Identity | None = None
    expected_version: int | None = Field(default=None, gt=0)
    parent_id: Identity | None = None


class RepairRead(Contract):
    """返工展示服务端核算的实际变化，避免多变量伪称单变量。"""

    revision: RevisionSnapshot[RepairItem]
    current: bool
    changed_factors: list[str]
    prepared_plan_ids: list[Identity] = Field(default_factory=list)


class FeedbackRead(Contract):
    """业务记录来自版本存储，current 由当前采用实时决定。"""

    active_cut_revision_id: Identity | None
    current_review_id: Identity | None
    reviews: list[RevisionSnapshot[CutReview]]
    repairs: list[RepairRead]
    knowledge: list[RevisionSnapshot[KnowledgeCandidate]]


class RepairPlanRequest(Contract):
    """用户明确指定本次局部覆盖和时长，生成草稿而非付费请求。"""

    coverage_item_ids: list[Identity] = Field(min_length=1)
    action_scope: Text
    duration_ms: int = Field(gt=0)
