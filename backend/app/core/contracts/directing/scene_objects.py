"""场次对象提取和资产参考准备的独立契约。"""

from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity, Text
from app.core.contracts.directing.workspace import AssetSummary, SourceSpan
from app.core.contracts.task import TaskStatus


class ObjectExtractionRequest(Contract):
    """以请求身份重复核实同一次场次对象提取。"""

    request_id: Identity
    model_id: Identity | None = None


class ExtractedSceneObject(Contract):
    """模型只描述对象和明确出处，资产身份仅是关联建议。"""

    kind: Literal['character', 'scene', 'prop']
    name: Text = Field(max_length=255)
    description: str = Field(default='', max_length=2000)
    excerpt: Text = Field(max_length=1500)
    asset_id: Identity | None = None


class SceneObjectExtraction(Contract):
    """有出处的候选清单，空场可以没有对象。"""

    objects: list[ExtractedSceneObject] = Field(max_length=100)


class SceneObjectCandidate(Contract):
    """服务端建立对象身份，并独立保存用户的关联与图片选择。"""

    id: Identity
    kind: Literal['character', 'scene', 'prop']
    name: str
    description: str
    excerpt: str
    span: SourceSpan
    suggested_asset_id: Identity | None = None
    asset_id: Identity | None = None
    image_file_id: Identity | None = None


class SceneObjectRead(SceneObjectCandidate):
    """实际文件可用性按当前项目资产读取，已选文件不可用时仍可识别旧选择。"""

    reference_state: Literal['unassociated', 'missing', 'ready', 'unavailable']


class SceneObjectChoice(Contract):
    """在同一准备修订上保存明确选择。省略图片表示当前不选。"""

    expected_revision: int = Field(gt=0)
    asset_id: Identity | None = None
    image_file_id: Identity | None = None


class SceneObjectTaskRead(Contract):
    """只公开任务状态和已清理的错误。"""

    task_id: Identity
    status: TaskStatus
    stage: str
    error: str | None = None


class SceneObjectsRead(Contract):
    """当前候选及项目资产，无待执行或已采用的画布输入。"""

    revision: int = Field(ge=0)
    source_version: str | None = None
    source_changed: bool = False
    task: SceneObjectTaskRead | None = None
    candidate_task_id: Identity | None = None
    objects: list[SceneObjectRead]
    assets: list[AssetSummary]


class SceneObjectCandidateApplication(Contract):
    """绑定预览修订和候选依据的一次整批应用确认。"""

    expected_revision: int = Field(ge=0)
    preview_token: str = Field(min_length=64, max_length=64)


class SceneObjectCandidateReceipt(Contract):
    """重复确认返回实际保存时的修订，不覆盖之后的人工选择。"""

    task_id: Identity
    revision: int = Field(gt=0)


class SceneObjectExtractionResult(Contract):
    """Worker 保存冻结对象和采用状态。候选本身不包含人工准备选择。"""

    objects: list[SceneObjectCandidate]
    pending_application: bool
    applied_revision: int | None = None
    application: SceneObjectCandidateApplication | None = None


class SceneObjectCandidateReview(Contract):
    """冻结结果相对当前对象准备的差异，只提供整批预览依据。"""

    task: SceneObjectTaskRead
    revision: int = Field(ge=0)
    source_changed: bool
    is_current: bool
    applied_revision: int | None = None
    preview_token: str | None = None
    added: list[SceneObjectCandidate]
    removed: list[SceneObjectCandidate]
    modified: list[SceneObjectCandidate]
    retained_choices: list[SceneObjectCandidate]
