"""当前场次版本的采用时间线，明确区分真实媒体与待拍占位。"""
from typing import Annotated, Literal

from pydantic import ConfigDict, Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.production import MediaCutItem, SequenceCut


class ScenePlannedCutItem(Contract):
    """占位引用当前方案镜头，预计时长不伪装为真实媒体区间。"""

    kind: Literal['planned']
    id: Identity
    shot_id: Identity
    estimated_duration_ms: int = Field(gt=0)
    timeline_start_ms: int = Field(ge=0)


class SceneMediaCutItem(MediaCutItem):
    """单次采用独立定位同场次原素材和文件，同一 Take 可重复采用。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    fit: Literal['contain', 'cover'] = Field(default='contain', description='完整显示保留黑边；填满等比例居中裁切，逐次采用独立保存。')
    take_kind: Literal['production_plan', 'scene_video']
    file_id: Identity


class SceneTimeline(SequenceCut):
    """复用单轨身份与重叠校验，允许空轨及有意保留的位置空白。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    items: list[Annotated[ScenePlannedCutItem | SceneMediaCutItem, Field(discriminator='kind')]] = Field(default_factory=list)
