"""场次分镜任务的语义输出与可应用的共同画布候选。"""

from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity, Text
from app.core.contracts.directing.scene_objects import SceneObjectTaskRead
from app.core.contracts.generation_canvas import CanvasStoryboardMode
from app.schemas.generation_canvas import CanvasDocument


class StoryboardRequest(Contract):
    """显式创建目标画布并提交一次文本分镜。"""

    request_id: Identity
    name: str = Field(default='', max_length=255)
    text_model_id: Identity | None = None
    production_model_id: Identity | None = None
    mode: CanvasStoryboardMode = 'complete'


class StoryboardField(Contract):
    """设计内容、理由及原样摘录，服务端核对原文出处。"""

    state: Literal['fact', 'proposal', 'undecided', 'absent', 'not_applicable']
    purpose: Literal['background', 'design', 'constraint'] = 'design'
    text: str = Field(default='', max_length=4000)
    excerpt: str = Field(default='', max_length=4000)
    reason: str = Field(default='', max_length=1000)


class StoryboardObject(Contract):
    """准备后补发现的对象，不允许模型分配真实资产或文件。"""

    id: Identity
    kind: Literal['character', 'scene', 'prop']
    name: Text = Field(max_length=255)
    excerpt: Text = Field(max_length=1500)


class StoryboardDesign(Contract):
    """一个直接适用于当前镜头的设计；字段须是实际卡片字段。"""

    id: Identity
    card_type: str
    object_id: Identity | None = None
    fields: dict[str, StoryboardField] = Field(min_length=1, max_length=32)


class StoryboardShot(Contract):
    """按原文顺序组织可见结果和直接设计，不推定复杂阶段。"""

    id: Identity
    excerpt: Text = Field(max_length=4000)
    object_ids: list[Identity] = Field(default_factory=list, max_length=50)
    narrative_role: StoryboardField | None = None
    visible_result: StoryboardField | None = None
    estimated_duration: StoryboardField | None = None
    beat: StoryboardField | None = None
    designs: list[StoryboardDesign] = Field(default_factory=list, max_length=30)


class SceneStoryboard(Contract):
    """临时分镜结构，只进入任务记录与确定性建卡。"""

    missed_objects: list[StoryboardObject] = Field(default_factory=list, max_length=100)
    shots: list[StoryboardShot] = Field(min_length=1, max_length=30)


class StoryboardCandidate(Contract):
    """验证后的首批共同文档和目标修订，编辑仍走共同保存。"""

    base_revision: int
    document: CanvasDocument


class StoryboardTaskRead(SceneObjectTaskRead):
    """真实任务状态及成功后可读取的候选。"""

    canvas_id: Identity
    pending_application: bool = False
    candidate: StoryboardCandidate | None = None
