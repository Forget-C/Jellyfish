"""检查卡的公开输入投影及独立报告契约。"""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.core.contracts.generation_canvas import OutputIdentity
from app.schemas.generation_canvas import CanvasCompiledInput, CanvasModelCapability


class CanvasCheckBasis(BaseModel):
    """绑定当前模型目标的公开编译结果，排除供应商执行配置。"""
    target_card_id: str
    revision: int
    basis_hash: str
    model_id: str | None
    parameters: dict[str, str | int | float | bool | None]
    capability: CanvasModelCapability | None = None
    input: CanvasCompiledInput
    observed_model_inputs: list[str] = Field(default_factory=list)


class CanvasCheckItem(BaseModel):
    """按采用来源及字段定位的稳定检查项目。"""
    id: str
    category: str
    label: str
    source: OutputIdentity
    field_id: str
    requirement: str
    enabled: bool
    availability: Literal['ready', 'unavailable'] = 'ready'
    reason: str | None = None
    scope_note: str | None = None
    scope_editable: bool = False
    input_stamp: str | None = Field(default=None, description='本项实际核对的依据标记，用于与当前项目比较。')


class CanvasCheckCategory(BaseModel):
    """类别选择与当前依据适用性独立表达。"""
    id: str
    label: str
    enabled: bool
    availability: Literal['ready', 'unavailable', 'not_applicable']
    reason: str | None = None


class CanvasCheckOmission(BaseModel):
    """整卡检查只记录未纳入执行的理由，不将跳过项标作通过。"""
    item_id: str
    label: str
    source_card_id: str
    status: Literal['disabled', 'unavailable']
    reason: str


class CanvasCheckPreview(BaseModel):
    """连接后列项，用户显式发起执行。"""
    basis: CanvasCheckBasis | None = None
    items: list[CanvasCheckItem] = Field(default_factory=list)
    categories: list[CanvasCheckCategory] = Field(default_factory=list)
    reason: str | None = None


class CanvasCheckRequest(BaseModel):
    """检查当前显示的依据；单项执行必须明确指定其身份。"""
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=0)
    basis_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    item_id: str | None = Field(default=None, min_length=1, max_length=256)


class CanvasCheckRecheckRequest(BaseModel):
    """One supplemental lead for one completed result in a pinned report."""
    model_config = ConfigDict(extra='forbid')
    item_id: str = Field(min_length=1, max_length=256)
    clarification: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class CanvasCheckTextEvidence(BaseModel):
    """Exact excerpt and location in a frozen check input."""
    source: OutputIdentity
    field_id: str
    excerpt: str


class CanvasCheckMediaInterval(BaseModel):
    """Time bounds in the retained product's millisecond timeline."""
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)


class CanvasCheckVideoRange(CanvasCheckMediaInterval):
    """Original range submitted as video and requested provider sampling rate."""
    sampling_fps: int = Field(gt=0)


class CanvasCheckVideoMoment(BaseModel):
    """A model-estimated visible point in the retained source timeline."""
    model_config = ConfigDict(extra='forbid')
    phase: Literal['before', 'during', 'after']
    at_ms: int = Field(strict=True)
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class CanvasCheckMediaObservation(BaseModel):
    """Public identity and visible evidence for media supplied to a check model."""
    modality: Literal['image', 'video']
    file_id: str
    description: str | None = None
    frame_at_ms: int | None = Field(default=None, ge=0, exclude_if=lambda value: value is None)
    video_range: CanvasCheckVideoRange | None = Field(default=None, exclude_if=lambda value: value is None)
    evidence_range: CanvasCheckMediaInterval | None = Field(default=None, exclude_if=lambda value: value is None)
    moments: list[CanvasCheckVideoMoment] = Field(default_factory=list, exclude_if=lambda value: not value)


class CanvasPostCheckRequest(CanvasCheckRequest):
    """Require acknowledgement of the call estimate for the selected product."""
    expected_calls: int = Field(ge=0)


class CanvasCheckResult(BaseModel):
    """结论只覆盖这一项的已观测依据。"""
    item_id: str
    outcome: Literal['conforming', 'nonconforming', 'risk', 'indeterminate']
    message: str
    boundary: str
    submitted_excerpt: str | None = None
    text_evidence: list[CanvasCheckTextEvidence] = Field(default_factory=list)
    observed_media: list[CanvasCheckMediaObservation] = Field(default_factory=list)


class CanvasCheckRecheck(BaseModel):
    """Original finding and the lead used exclusively in this recheck."""
    report_id: str
    clarification: str
    original_result: CanvasCheckResult


class CanvasCheckExecution(BaseModel):
    """任务状态独立于观察结论；失败不会填入业务结果。"""
    item_id: str
    status: Literal['queued', 'running', 'succeeded', 'failed', 'cancelled']
    cancel_requested: bool = False
    reason: str | None = None


class CanvasCheckProduct(BaseModel):
    """历史产物身份由具体运行、节点和产物位置固定。"""
    run_id: str
    node_id: str
    position: int
    source: OutputIdentity
    generation_status: Literal['succeeded', 'failed', 'cancelled']
    result_set_id: str | None = None
    revision: int
    text: str | None = None
    modality: Literal['text', 'image', 'video'] = 'text'
    file_id: str | None = None


class CanvasPostCheckPreview(BaseModel):
    """分别显示当前检查卡修订及历史生成依据，执行由用户明确触发。"""
    revision: int
    product: CanvasCheckProduct
    basis: CanvasCheckBasis
    items: list[CanvasCheckItem]
    estimated_calls: int
    observation_method: Literal['text', 'image', 'video_frame', 'video_sequence', 'video_mixed'] = 'text'
    reason: str | None = None


class CanvasCheckConfiguration(BaseModel):
    """Public selection saved with the report, excluding provider credentials."""
    categories: list[str]
    disabled_items: list[str]
    scope_notes: dict[str, str]
    auto_post_check: bool | None = None


class CanvasCheckReportRead(BaseModel):
    """固定本轮目标、依据、所选项目与结果；重查形成新身份。"""
    id: str
    check_card_id: str
    created_at: datetime
    scope: Literal['all', 'item']
    basis: CanvasCheckBasis
    items: list[CanvasCheckItem]
    results: list[CanvasCheckResult]
    omitted: list[CanvasCheckOmission] = Field(default_factory=list)
    check_model_id: str | None = None
    configuration: CanvasCheckConfiguration | None = None
    recheck_item_ids: list[str] = Field(default_factory=list)
    executions: list[CanvasCheckExecution] = Field(default_factory=list)
    enabled_item_ids: list[str] | None = Field(default=None, description='执行时启用的项目；可与本轮实际执行范围不同。')
    product: CanvasCheckProduct | None = None
    recheck: CanvasCheckRecheck | None = None
    automatic: bool = False
