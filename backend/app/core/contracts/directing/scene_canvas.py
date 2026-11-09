"""场次准备页只使用当前场次、真实画布身份及固定依据状态。"""

from pydantic import Field
from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.workspace import SequenceRead


class SceneCanvasCreate(Contract):
    """允许用户采用默认名称或提供自己的画布名称。"""

    name: str = Field(default='', max_length=255)


class SceneCanvasSummary(Contract):
    """准备页的轻量入口，打开后仍走共同画布读取。"""

    id: Identity
    name: str
    source_changed: bool


class SceneCanvasesRead(Contract):
    """一份场次摘要及本场独立画布。"""

    sequence: SequenceRead
    canvases: list[SceneCanvasSummary]
