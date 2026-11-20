"""划分历史摘要不携带正文；展开时按身份读取不可变快照。"""

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.workspace import ChapterSequences, DivisionResult, DivisionVersionRef
from app.core.contracts.directing.division import DivisionBaseline


class DivisionHistoryEntry(Contract):
    """保存版本和未关联分析共用列表，任务状态不占正式版本号。"""

    id: Identity
    kind: Literal['version', 'analysis']
    number: int | None
    origin: str
    created_at: datetime
    sequence_count: int | None
    status: str
    progress: int | None
    is_current: bool
    source_task_id: Identity | None
    save_relation: Literal['saved', 'unsaved', 'not_applicable'] = 'not_applicable'


class DivisionHistoryPage(Contract):
    items: list[DivisionHistoryEntry]
    active_task_ids: list[Identity] = Field(default_factory=list)
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    current_version: DivisionVersionRef | None


class DivisionVersionDetail(Contract):
    """只返回已保存的当时正文和成员，不用当前场次拼接历史。"""

    version: DivisionHistoryEntry
    chapter: ChapterSequences
    source_revision_id: Identity | None
    base_revision_id: Identity | None
    mapping: dict
    restored_baseline: list[DivisionBaseline]


class DivisionAnalysisDetail(Contract):
    """只返回业务所需冻结输入；缺失或损坏的历史资料明确列出。"""

    analysis: DivisionHistoryEntry
    raw_text: str | None
    source_version: str | None
    baseline: list[DivisionBaseline] | None
    result: DivisionResult | None
    source_changed: bool
    baseline_changed: bool
    issues: list[str]
    saved_versions: list[DivisionVersionRef]
