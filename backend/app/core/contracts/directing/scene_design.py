"""可编辑场次版本的 AI 设计请求与整份预览，不建立独立设计草稿。"""
from datetime import datetime

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.design_scope import DesignScopeIssue
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
    issues: list[DesignScopeIssue] = Field(default_factory=list)


class SceneDesignDiagnostics(Contract):
    """失败输出仅供核对，不属于可应用的类型化设计。"""

    output: str
    issues: list[str]


class SceneDesignCandidate(Contract):
    """通过数据契约的整场候选；缺项与后续失败诊断不冒充已完成设计。

    attempt 标识候选实际来自哪轮生成。纠错损坏结果时保留上一合法候选，
    diagnostics 只描述随后未被接收的输出，不属于该候选的缺项。
    """

    design: EditableSceneDesign
    issues: list[DesignScopeIssue]
    attempt: int = Field(ge=1, le=2)
    diagnostics: SceneDesignDiagnostics | None = None


def parse_scene_design_candidate(value: dict, run_args: dict) -> SceneDesignCandidate | None:
    """按冻结契约识别候选封装；历史平铺设计仍交给原设计契约读取。"""
    if (run_args.get('design_candidate_version') == 1 and not run_args.get('design_scope')
            and isinstance(value, dict) and 'design' in value):
        return SceneDesignCandidate.model_validate(value)
    return None


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
    diagnostics: SceneDesignDiagnostics | None = None
    issues: list[DesignScopeIssue] = Field(default_factory=list)
    candidate_attempt: int | None = None
