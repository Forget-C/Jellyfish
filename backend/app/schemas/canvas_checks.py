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


class CanvasCheckPreview(BaseModel):
    """连接后列项，用户显式发起执行。"""
    basis: CanvasCheckBasis | None = None
    items: list[CanvasCheckItem] = Field(default_factory=list)
    reason: str | None = None


class CanvasCheckRequest(BaseModel):
    """检查当前显示的依据；单项执行必须明确指定其身份。"""
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=0)
    basis_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    item_id: str | None = Field(default=None, min_length=1, max_length=256)


class CanvasCheckResult(BaseModel):
    """结论只覆盖这一项的已观测依据。"""
    item_id: str
    outcome: Literal['conforming', 'nonconforming', 'risk', 'indeterminate']
    message: str
    boundary: str


class CanvasCheckReportRead(BaseModel):
    """固定本轮目标、依据、所选项目与结果；重查形成新身份。"""
    id: str
    check_card_id: str
    created_at: datetime
    scope: Literal['all', 'item']
    basis: CanvasCheckBasis
    items: list[CanvasCheckItem]
    results: list[CanvasCheckResult]
