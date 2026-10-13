"""章节明确使用的固定场次内容，独立于当前可编辑版本。"""
from datetime import datetime

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.scene_cut_review import SceneCutReviewDecision
from app.core.contracts.directing.scene_take_library import SceneTakeLibraryRead
from app.core.contracts.directing.scene_version import SceneVersionContent


class SceneDeliveryCreate(Contract):
    """先保存再交付指定修订，原请求核实不重新激活历史交付。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)


class SceneDeliveryRead(Contract):
    """内容及审片结论固定；媒体可用性按真实文件读取。"""

    id: Identity
    sequence_id: Identity
    version_id: Identity
    version_title: str
    revision: int
    request_id: Identity
    content: SceneVersionContent
    review_id: Identity | None
    review: SceneCutReviewDecision | None
    takes: list[SceneTakeLibraryRead]
    created_at: datetime


class ChapterSceneDelivery(Contract):
    """当前章节顺序与明确交付来源分别表达。"""

    sequence_id: Identity
    title: str
    position: int
    delivery: SceneDeliveryRead | None


class ChapterDeliveriesRead(Contract):
    """不把未交付场次或未验收画面提升为已使用／已通过。"""

    chapter_id: Identity
    title: str
    sequences: list[ChapterSceneDelivery]
