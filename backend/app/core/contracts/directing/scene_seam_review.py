"""接缝审查绑定明确的两次真实采用，预演和时间空白不形成接缝。"""
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, Text
from app.core.contracts.directing.scene_version import SceneVersionContent


class SceneSeamReviewDecision(Contract):
    """人工观察与成立内容、待处理问题固定保存，不替代整场验收。"""

    verdict: Literal['pass', 'revise']
    observation: Text
    established: str = ''
    issues: str = ''


class SceneSeamReviewCreate(Contract):
    """按原保存修订与片段身份提交；不按 Take 名称或最近结果重绑。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    left_clip_id: Identity
    right_clip_id: Identity
    decision: SceneSeamReviewDecision

    @model_validator(mode='after')
    def distinct_clips(self):
        """一次采用不能与自身形成接缝。"""
        if self.left_clip_id == self.right_clip_id:
            raise ValueError('接缝两侧必须是不同的采用片段')
        return self


class SceneSeamReviewRead(Contract):
    """保留当时完整内容，适用性只比较该真实接缝及输出构图。"""

    id: Identity
    version_id: Identity
    request_id: Identity
    revision: int
    left_clip_id: Identity
    right_clip_id: Identity
    decision: SceneSeamReviewDecision
    content: SceneVersionContent
    created_at: datetime
    matches_current: bool
