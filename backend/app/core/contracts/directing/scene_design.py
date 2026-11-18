"""导演设计历史候选与分镜任务诊断。"""

from pydantic import Field

from app.core.contracts.directing.common import Contract
from app.core.contracts.directing.design_scope import DesignScopeIssue
from app.core.contracts.directing.scene_version import EditableSceneDesign


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
