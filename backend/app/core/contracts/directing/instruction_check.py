"""旧单元指令检查的历史结果与视频要求去向。"""

from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity, Text
from app.core.contracts.directing.production import ReviewRow


class InstructionDestination(Contract):
    """固定投影中一项视频要求在最终正文或实际参考中的去向。"""

    owner: str
    field: str
    coverage_item_ids: list[Identity]
    destination: Literal['instruction', 'reference', 'unresolved']
    instruction_excerpt: str | None = None
    reference_id: Identity | None = None
    rationale: Text


class InstructionCheckResult(Contract):
    """六岗逐覆盖项检查；结论不能授权生成或修改正文。"""

    unit_id: Identity
    rows: list[ReviewRow] = Field(min_length=1)
    destinations: list[InstructionDestination] | None = None
