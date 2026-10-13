"""人工素材审查形成时的方案依据，只读记录与当前可变内容分开。"""
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.scene_version import SceneVersionContent


class SceneTakeReviewRead(Contract):
    """保存修订只用于定位记录形成时刻，适用性不改写固定内容。"""

    id: Identity
    version_id: Identity
    revision: int
    take_kind: Literal['production_plan', 'scene_video']
    take_id: Identity
    content: SceneVersionContent
    created_at: datetime
    matches_current: bool


class SceneTakeReviewConfirm(Contract):
    """明确复核已保存的同一份方案，修订与素材身份共同保证幂等。"""

    expected_revision: int = Field(gt=0)
    take_kind: Literal['production_plan', 'scene_video']
    take_id: Identity
