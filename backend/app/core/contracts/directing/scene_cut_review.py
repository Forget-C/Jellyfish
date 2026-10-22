"""可编辑场次的整场验收：结论与发生时的真实剪辑固定保存。"""
from datetime import datetime

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.scene_cut_decision import SceneCutReviewDecision
from app.core.contracts.directing.scene_version import SceneVersionContent


class SceneCutReviewCreate(Contract):
    """明确审查指定已保存修订；请求身份用于未知响应后核实同一次操作。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    decision: SceneCutReviewDecision


class SceneCutReviewRead(Contract):
    """固定人工结论及完整内容，当前适用性只读计算。"""

    id: Identity
    version_id: Identity
    request_id: Identity
    revision: int
    decision: SceneCutReviewDecision
    content: SceneVersionContent
    created_at: datetime
    matches_current: bool
