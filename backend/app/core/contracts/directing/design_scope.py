"""历史设计候选中的字段缺项。"""

from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract


class DesignScopeIssue(Contract):
    """缺项定位到原对象与字段；可保存不代表设计或拍摄准备完整。"""

    owner: str
    field: str
    path: list[str | int]
    reason: str
    shot_ids: list[str] = Field(default_factory=list)
    code: Literal['incomplete', 'empty_row_scope'] = 'incomplete'
    missing_scope_fields: list[str] = Field(default_factory=list)
