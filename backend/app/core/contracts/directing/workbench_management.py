"""章节级工作台管理的场次浏览摘要。"""

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.task import TaskStatus


class WorkbenchTaskSummary(Contract):
    """列表只需任务身份与真实状态，不携带输入、候选或执行详情。"""

    task_id: Identity
    status: TaskStatus


class WorkbenchSceneSummary(Contract):
    """场次的共同画布与准备计数，区别于旧版导演生产计数。"""

    id: Identity
    position: int
    title: str
    source_excerpt: str
    source_changed: bool
    object_count: int = Field(ge=0)
    canvas_count: int = Field(ge=0)
    has_object_preparation: bool
    preparation_stale: bool
    object_task: WorkbenchTaskSummary | None
    storyboard_task: WorkbenchTaskSummary | None


class ChapterWorkbenchManagement(Contract):
    """当前及历史场次分别排序，不携带画布或资产文档。"""

    chapter_id: Identity
    title: str
    has_source: bool
    sequences: list[WorkbenchSceneSummary]
    historical_sequences: list[WorkbenchSceneSummary]
