"""检查卡的公开输入投影及独立报告契约。"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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


class CanvasCheckTextEvidence(BaseModel):
    """Exact excerpt and location in a frozen check input."""
    source: OutputIdentity
    field_id: str
    excerpt: str


class CanvasCheckResult(BaseModel):
    """结论只覆盖这一项的已观测依据。"""
    item_id: str
    outcome: Literal['conforming', 'nonconforming', 'risk', 'indeterminate']
    message: str
    boundary: str
    submitted_excerpt: str | None = None
    text_evidence: list[CanvasCheckTextEvidence] = Field(default_factory=list)


class CanvasCheckExecution(BaseModel):
    """任务状态独立于观察结论；失败不会填入业务结果。"""
    item_id: str
    status: Literal['queued', 'running', 'succeeded', 'failed', 'cancelled']
    cancel_requested: bool = False
    reason: str | None = None


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
    executions: list[CanvasCheckExecution] = Field(default_factory=list)
    enabled_item_ids: list[str] | None = Field(default=None, description='执行时启用的项目；可与本轮实际执行范围不同。')
