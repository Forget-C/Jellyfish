"""场次分镜任务的语义输出与可应用的共同画布候选。"""

from typing import Literal

from pydantic import Field, PrivateAttr

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


class StoryboardScope(Contract):
    """明确的拍摄适用声明；空镜头列表表示所属镜头或全场。"""

    shot_ids: list[Identity] = Field(default_factory=list, max_length=30)
    phase: Literal['all', 'image', 'video', 'sound', 'postproduction'] = 'all'
    condition_id: Identity | None = None
    occurrence_ids: list[Identity] = Field(default_factory=list, max_length=30)


class StoryboardDependency(Contract):
    """设计引用的是逻辑字段；组装时解析为分拆后的真实卡和用途。"""

    design_id: Identity
    field_id: Identity
    relation: Literal['context', 'anchor', 'position', 'event'] = 'context'
    candidate: bool = False


class StoryboardField(Contract):
    """设计内容、理由及原样摘录，服务端核对原文出处。"""

    state: Literal['fact', 'proposal', 'undecided', 'absent', 'not_applicable']
    purpose: Literal['background', 'design', 'constraint'] = 'design'
    text: str = Field(default='', max_length=4000)
    excerpt: str = Field(default='', max_length=4000)
    reason: str = Field(default='', max_length=1000)
    scope: StoryboardScope | None = None
    dependencies: list[StoryboardDependency] = Field(default_factory=list, max_length=20)


class StoryboardObject(Contract):
    """准备后补发现的对象，不允许模型分配真实资产或文件。"""

    id: Identity
    kind: Literal['character', 'scene', 'prop']
    name: Text = Field(max_length=255)
    excerpt: Text = Field(max_length=1500)


class StoryboardFrameTarget(Contract):
    """逻辑运镜及指定画面，不携带画布物理身份。"""

    design_id: Identity
    phase_id: Identity


class StoryboardMovementPhase(Contract):
    """运镜中的独立画面及其设计范围。"""

    id: Identity
    name: Text = Field(max_length=120)
    frame: StoryboardField


class StoryboardDesign(Contract):
    """一个逻辑设计，字段按实际适用范围映射到现有卡型。"""

    id: Identity
    card_type: str
    object_id: Identity | None = None
    adoption: Literal['model', 'dependency'] = 'model'
    fields: dict[str, StoryboardField] = Field(default_factory=dict, max_length=32)
    phases: list[StoryboardMovementPhase] = Field(default_factory=list, max_length=16)
    frame_target: StoryboardFrameTarget | None = None


class StoryboardOccurrence(Contract):
    """同一故事镜头内可独立制作的片段及实际参与、条件。"""

    id: Identity
    excerpt: Text = Field(max_length=4000)
    object_ids: list[Identity] | None = Field(default=None, max_length=50)
    condition_ids: list[Identity] = Field(default_factory=list, max_length=20)


class StoryboardProductionSegment(Contract):
    """组织能力只安排既有动作的分段时间与有效画幅。"""

    id: Identity
    excerpt: Text = Field(max_length=4000)
    seconds: int | None = Field(default=None, gt=0)
    ratio: str = Field(max_length=16)


class StoryboardOrganizedShot(Contract):
    """按原序组织一个超限或有独立出现项的镜头。"""

    id: Identity
    segments: list[StoryboardProductionSegment] = Field(min_length=2, max_length=16)


class StoryboardOrganization(Contract):
    """同一工作台文本任务按需调用的组织输出。"""

    shots: list[StoryboardOrganizedShot] = Field(min_length=1, max_length=30)


class StoryboardShot(Contract):
    """按原文顺序组织唯一的故事镜头及制作依据。"""

    id: Identity
    excerpt: Text = Field(max_length=4000)
    object_ids: list[Identity] = Field(default_factory=list, max_length=50)
    narrative_role: StoryboardField | None = None
    visible_result: StoryboardField | None = None
    estimated_duration: StoryboardField | None = None
    beat: StoryboardField | None = None
    estimated_seconds: int | None = Field(default=None, gt=0, le=600)
    condition_ids: list[Identity] = Field(default_factory=list, max_length=20)
    occurrences: list[StoryboardOccurrence] = Field(default_factory=list, max_length=16)
    frame_targets: list[StoryboardFrameTarget] = Field(default_factory=list, max_length=20)
    designs: list[StoryboardDesign] = Field(default_factory=list, max_length=30)


class SceneStoryboard(Contract):
    """临时分镜结构，只进入任务记录与确定性建卡。"""

    missed_objects: list[StoryboardObject] = Field(default_factory=list, max_length=100)
    shots: list[StoryboardShot] = Field(min_length=1, max_length=30)
    designs: list[StoryboardDesign] = Field(default_factory=list, max_length=160)
    conditions: dict[Identity, Text] = Field(default_factory=dict, max_length=40)
    _production: dict[str, list[StoryboardProductionSegment]] = PrivateAttr(default_factory=dict)

    def attach_production(self, organization: StoryboardOrganization) -> None:
        """组织结果来自同一任务内第二步验证，不能由提取响应写入。"""
        self._production = {shot.id: shot.segments for shot in organization.shots}

    def production_segments(self, shot_id: str) -> list[StoryboardProductionSegment]:
        """返回该镜头已经过校验的制作片段。"""
        return self._production.get(shot_id, [])


class StoryboardCandidate(Contract):
    """验证后的首批共同文档和目标修订，编辑仍走共同保存。"""

    base_revision: int
    document: CanvasDocument


class StoryboardTaskRead(SceneObjectTaskRead):
    """真实任务状态及成功后可读取的候选。"""

    canvas_id: Identity
    pending_application: bool = False
    candidate: StoryboardCandidate | None = None
