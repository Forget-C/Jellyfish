"""整份另存使用点击时内容，任务终态与历史证据归属另行核实。"""
from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.scene_version import SceneVersionContent


class SceneVersionCopy(Contract):
    """不预先保存来源版本；固定原修订、完整内容和一次创建授权。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=255, pattern=r'\S')
    content: SceneVersionContent


class SceneCopyBlocker(Contract):
    """非终态任务或无法核实的执行阻止复制，不把取消请求当作完成。"""

    task_id: Identity | None
    execution_id: Identity | None
    title: str
    status: str


class SceneCopyReadiness(Contract):
    """只读预检不授权稍后的创建；创建事务必须重新核验。"""

    ready: bool
    blockers: list[SceneCopyBlocker]
