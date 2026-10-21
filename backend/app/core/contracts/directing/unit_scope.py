"""指令、历史依据和只读画布共用的单元消费范围。"""

from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity, Source


class UnitScopeUse(Contract):
    """一项固定输入的原字段、来源与实际纳入原因。"""

    owner: str
    field: str
    text: str
    sources: list[Source]
    reason: str
    coverage_item_ids: list[Identity] = Field(default_factory=list)
    phase: Literal['video', 'sound', 'postproduction'] | None = None
    condition: str | None = None


class UnitScopeProjection(Contract):
    """按单元出现项固定执行、约束与解释背景，不以画布归位推定拍摄范围。"""

    version: int = 1
    execution: list[UnitScopeUse]
    constraints: list[UnitScopeUse]
    background: list[UnitScopeUse]
    unresolved: list[str]

    def same_video_consumption(self, other: 'UnitScopeProjection') -> bool:
        """声音与后期约束保留在快照中，但不使视频正文依据失效。"""
        return (self.version == other.version and self.execution == other.execution
                and [row for row in self.constraints if row.phase == 'video']
                == [row for row in other.constraints if row.phase == 'video']
                and self.background == other.background and self.unresolved == other.unresolved)


