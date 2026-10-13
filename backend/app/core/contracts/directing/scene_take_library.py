"""跨方案复用素材时保留原固定生产来源。"""
from typing import Literal

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.production import ProductionPlan, Prompt
from app.core.contracts.directing.scene_video import SceneVideoPreparation


class SceneTakeLibraryRead(Contract):
    """文件可用性为登记状态，播放和执行仍核验实际读取结果。"""

    take_kind: Literal['production_plan', 'scene_video']
    take_id: Identity
    file_id: Identity
    origin_id: Identity
    unit_id: Identity
    task_id: Identity
    duration_ms: int | None
    available: bool
    media_url: str | None
    prompt: Prompt | None = None
    production_plan: ProductionPlan | None = None
    video_preparation: SceneVideoPreparation | None = None
