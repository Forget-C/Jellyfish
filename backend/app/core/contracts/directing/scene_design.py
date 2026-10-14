"""可编辑场次版本的 AI 设计请求与整份预览，不建立独立设计草稿。"""
from datetime import datetime

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.scene_version import EditableSceneDesign, SceneVersionContent, SceneVersionSource


class SceneDesignRequest(Contract):
    """冻结用户点击时的整场内容和请求身份；提交不等于应用建议。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    content: SceneVersionContent
    model_id: Identity | None = None
    instruction: str = Field(default='', max_length=12000)
    scope: list[str] | None = Field(default=None, min_length=1, max_length=100)


class SceneDesignPreviewRequest(Contract):
    """携带当前编辑内容重新核对，防止旧建议覆盖新人工修改。"""

    content: SceneVersionContent


class SceneDesignPreview(Contract):
    """已核实的整场建议与真实固定依据，仅供用户预览和明确应用。"""

    task_id: Identity
    scope: list[str] | None
    basis: SceneVersionSource
    before: EditableSceneDesign
    design: EditableSceneDesign


class SceneDesignSuggestionRead(Contract):
    """建议任务的版本归属、固定输入与结果；运行中不伪装成空设计。"""

    task_id: Identity
    scope: list[str] | None
    request_id: Identity
    created_at: datetime
    status: str
    error: str | None
    instruction: str
    basis: SceneVersionSource
    before: EditableSceneDesign
    design: EditableSceneDesign | None
