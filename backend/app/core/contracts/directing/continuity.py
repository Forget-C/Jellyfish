"""实际采用片段、落幅和接缝审查的契约，不从计划状态推导证据。"""
from datetime import datetime
from typing import Literal

from app.core.contracts.directing.common import Contract, Identity, MediaRange, Text


class CutFrameRequest(Contract):
    """从用户看到的已确认剪辑项提取入幅或落幅。"""

    cut_revision_id: Identity
    item_id: Identity
    edge: Literal['start', 'end']


class CutFrameRead(Contract):
    """不可变提帧来源及其相对当前采用版本的有效性。"""

    id: Identity
    cut_revision_id: Identity
    item_id: Identity
    take_id: Identity
    plan_revision_id: Identity
    unit_id: Identity
    file_id: Identity
    media_range: MediaRange
    at_ms: int
    edge: Literal['start', 'end']
    current: bool


class SeamReviewRequest(Contract):
    """人工查看相邻真实片段后，对明确的两张边界帧作出结论。"""

    cut_revision_id: Identity
    left_frame_id: Identity
    right_frame_id: Identity
    verdict: Literal['pass', 'revise']
    rationale: Text


class SeamRead(Contract):
    """当前实际相邻接缝与可复用的最近人工审查。"""

    left_item_id: Identity
    right_item_id: Identity
    status: Literal['pending', 'pass', 'revise']
    review_id: Identity | None = None
    rationale: str | None = None
    reviewed_at: datetime | None = None


class UnitContinuityRead(Contract):
    """逐个计划单元展示依赖失效原因，不自动启动补拍。"""

    plan_revision_id: Identity
    unit_id: Identity
    status: Literal['ready', 'blocked']
    errors: list[str]


class ContinuityRead(Contract):
    """当前已确认采用依据、实际边界帧、接缝与受影响单元。"""

    active_cut_revision_id: Identity | None
    frames: list[CutFrameRead]
    seams: list[SeamRead]
    units: list[UnitContinuityRead]
