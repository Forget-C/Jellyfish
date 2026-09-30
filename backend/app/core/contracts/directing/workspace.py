"""场次工作区 HTTP 与异步操作共用契约。"""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, Source, Text, Role
from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.review_revision import ReviewRevisionCandidate, ReviewRevisionRequest, ReviewRevisionApplication
from app.core.contracts.directing.production import ProductionPlan, ReviewPacket, SequenceCut, TakeAnnotation
from app.core.contracts.directing.revisions import (
    SceneDesignRevision, ProductionPlanRevision, PromptRevision, ReviewPacketRevision,
    SequenceCutRevision, TakeSnapshot,
)


class SourceSpan(Contract):
    """原文连续半开区间，使用 Python Unicode 字符索引；浏览器须转换 UTF-16 选区。"""

    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self):
        """拒绝空或倒置的故事段落。"""
        if self.end <= self.start:
            raise ValueError("原文范围结束位置必须晚于开始位置")
        return self


class SequenceCreate(Contract):
    """手动或 AI 确认范围；须含正文且不与同原文版本的其他场次相交。"""

    title: Text = Field(max_length=255)
    position: int = Field(ge=0)
    source_version: Text
    span: SourceSpan


class SequenceUpdate(SequenceCreate):
    """比较原版本；省略或置空 span 仅更新名称/顺序，保留原文依据及待核对状态。"""

    expected_version: int = Field(gt=0)
    span: SourceSpan | None = None


class SequenceRead(Contract):
    """当前场次及原文变化提示，保留最初选定文本。"""

    id: Identity
    project_id: Identity
    chapter_id: Identity
    position: int
    title: str
    version: int
    source: Source
    span: SourceSpan | None
    source_text: str
    source_changed: bool
    is_current: bool = True


class DivisionVersionRef(Contract):
    """章节划分展示版本；与场次并发修订号区分。"""

    id: Identity
    number: int = Field(gt=0)


class ChapterSequences(Contract):
    """章节原文与场次清单，支持刷新后恢复正确上下文。"""

    chapter_id: Identity
    title: str
    raw_text: str
    source_version: Text
    sequences: list[SequenceRead]
    task_ids: list[Identity] = Field(default_factory=list)
    current_version: DivisionVersionRef | None = None


class SequenceOverview(Contract):
    """整场版本与素材计数，不表示选定计划的准备度或实际覆盖。"""

    id: Identity
    position: int
    title: str
    source_excerpt: str
    source_changed: bool
    design_count: int = Field(ge=0)
    confirmed_design_count: int = Field(ge=0)
    plan_count: int = Field(ge=0)
    confirmed_plan_count: int = Field(ge=0)
    take_count: int = Field(ge=0)
    unreviewed_take_count: int = Field(ge=0)
    active_cut_revision_id: Identity | None


class ChapterOverview(Contract):
    """章节有序场次的轻量概览，不携带设计、计划或工作区正文。"""

    chapter_id: Identity
    title: str
    source_version: Text
    sequences: list[SequenceOverview]


class DivisionSuggestion(Contract):
    """模型返回原文逐字摘录，由服务转换字符范围，避免模型算错索引。"""

    title: Text
    excerpt: Text
    purpose: Text


class DivisionResult(Contract):
    """AI 划场只是建议，用户确认前不建立正式场次。"""

    scenes: list[DivisionSuggestion] = Field(min_length=1)


class AIRequest(Contract):
    """冻结本轮人工意见和起始版本供异步 AI 操作使用。"""

    model_id: Identity | None = None
    style_revision_id: Identity | None = None
    instruction: str = ""
    revision_id: Identity | None = None
    expected_version: int | None = Field(default=None, gt=0)


class ApplyDesignRequest(Contract):
    """明确采用任务建议；可指定起始草稿，冲突时保留独立建议版本。"""

    task_id: Identity


class ReviewRequest(AIRequest):
    """检查请求身份在当前场次内固定；重试不创建第二次模型检查。"""

    request_id: Identity | None = None


class DesignWrite(Contract):
    """六岗设计写入格式，前端通过 generated client 使用同一类型。"""

    kind: Literal["design"]
    content: SceneDesign


class PlanWrite(Contract):
    """单元和参考写入格式。"""

    kind: Literal["plan"]
    content: ProductionPlan


class CutWrite(Contract):
    """粗剪显式写入格式，不接受隐式采用。"""

    kind: Literal["cut"]
    content: SequenceCut


RevisionContent = Annotated[DesignWrite | PlanWrite | CutWrite, Field(discriminator="kind")]


class RevisionWrite(Contract):
    """创建、派生或 CAS 修改业务草稿，提示词与审稿由专用流程产生。"""

    document: RevisionContent
    sequence_version: int | None = Field(default=None, gt=0)
    revision_id: Identity | None = None
    expected_version: int | None = Field(default=None, gt=0)
    parent_id: Identity | None = None


class VersionRequest(Contract):
    """确认时固定用户看到的版本。"""

    expected_version: int = Field(gt=0)


class CompileRequest(Contract):
    """本轮只编译明确选定的单元，按钮行为登记为编译授权。"""

    plan_revision_id: Identity
    unit_id: Identity
    request_id: Identity | None = None


class ShootRequest(Contract):
    """只接受审过的固定输入和请求身份，不能夹带未审提示词。"""

    prompt_revision_id: Identity
    review_revision_id: Identity
    request_id: Identity


class TaskAccepted(Contract):
    """异步操作的轻量任务入口。"""

    task_id: Identity


class WorkspaceRead(Contract):
    """一份场次共享上下文，三视图不维护不同版本的真值。"""

    sequence: SequenceRead
    designs: list[SceneDesignRevision]
    plans: list[ProductionPlanRevision]
    prompts: list[PromptRevision]
    reviews: list[ReviewPacketRevision]
    cuts: list[SequenceCutRevision]
    takes: list[TakeSnapshot]
    task_ids: list[Identity]


class CompileResult(WorkspaceRead):
    """编译响应明确返回本次操作产出的指令，不从工作区排序推测。"""

    compiled_prompt_revision_id: Identity


class TakeReviewWrite(Contract):
    """人工审片保存，采用仍由独立粗剪写入完成。"""

    expected_version: int = Field(gt=0)
    annotation: TakeAnnotation


class MediaRead(Contract):
    """播放器消费服务端提供的素材地址和真实时长。"""

    take_id: Identity
    file_id: Identity
    url: str
    duration_ms: int | None
    thumbnail_url: str | None = None


class ReviewDecisionRequest(Contract):
    """明确记录人工艺术取舍，结构和能力检查仍不可绕过。"""

    role: Role
    occurrence_id: Identity
    reason: Text


class DirectingTaskRead(Contract):
    """业务面板查询建议；通用任务中心仍只展示状态。"""

    task_id: Identity
    kind: str
    status: str
    error: str | None
    source_version: str | None
    division_baseline: dict[Identity, int] | None = None
    division: DivisionResult | None = None
    design: SceneDesign | None = None
    review: ReviewPacket | None = None
    revision: ReviewRevisionCandidate | None = None
    revision_request: ReviewRevisionRequest | None = None
    revision_application: ReviewRevisionApplication | None = None
    image_file_ids: list[Identity] = Field(default_factory=list)


class VisualRequest(Contract):
    """本次验证图的固定设计、目的和显式参考，不隐式读取全项目素材。"""

    design_revision_id: Identity
    prompt: str = Field(min_length=1, max_length=12000)
    purpose: Literal["identity", "space", "composition", "continuity"]
    model_id: Identity | None = None
    reference_file_ids: list[Identity] = Field(default_factory=list, max_length=10)
    ratio: Literal["16:9", "9:16", "1:1"] = "16:9"


class AssetSummary(Contract):
    """场次可复用的项目资产身份，不复制本场调度状态到资产。"""

    id: Identity
    kind: Literal['character', 'scene', 'prop']
    name: str
    description: str
    image_file_ids: list[Identity] = Field(default_factory=list)
    unavailable_image_count: int = Field(default=0, ge=0)


class AssetCreateRequest(Contract):
    """同次创建固定请求身份，结果不明时重试不会重复建档；不修改本场设计。"""

    request_id: str = Field(pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    kind: Literal['character', 'scene', 'prop']
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default='', max_length=8000)


class ExtractFrameRequest(Contract):
    """以真实素材毫秒位置提帧，不使用计划预计时长。"""

    at_ms: int = Field(ge=0)


class ExtractedFrame(Contract):
    """提帧文件及真实视频来源，供后续参考绑定和接缝检查。"""

    file_id: Identity
    source: Source


class RegroupRequest(Contract):
    """在已确认计划上明确拆分或组合单元，结果只能是新计划草稿。"""

    plan_revision_id: Identity
    unit_ids: list[Identity] = Field(min_length=1)
    operation: Literal['split', 'merge']
