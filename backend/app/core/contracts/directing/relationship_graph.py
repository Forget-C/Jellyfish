"""设计对象关系、字段用途与展示归位的纯数据契约。"""

from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.design_applicability import DesignApplicability, DesignOccurrence
from app.core.contracts.directing.design_scope import DesignScopeIssue


class RelationshipNode(Contract):
    """对象的来源路径；历史无 ID 行仅以路径定位，不赋予持久身份。"""

    key: str
    kind: str
    path: list[str | int]
    stable: bool = True
    missing: bool = False
    placement: Literal['scene_background', 'scene_rule', 'shots', 'occurrences',
                       'pending_shot', 'unlinked'] = 'unlinked'
    shot_ids: list[Identity] = Field(default_factory=list)
    reason: str = ''


class RelationshipEdge(Contract):
    """一条真实字段引用；owner 和 field 可定位原始编辑位置。"""

    owner: str
    field: str
    target: str
    target_id: str


class RelationshipPath(Contract):
    """间接到达只展示连续的真实字段引用，不创建可编辑边。"""

    source: str
    target: str
    steps: list[RelationshipEdge] = Field(min_length=2)


class RelationshipUse(Contract):
    """原字段或独立条目的内容用途；背景不自动变成执行要求。"""

    owner: str
    field: str
    purpose: Literal['background', 'design', 'constraint']
    scope: Literal['scene', 'scene_rule', 'shots', 'occurrences'] | None = None
    shot_ids: list[Identity] = Field(default_factory=list)
    occurrences: list[DesignOccurrence] = Field(default_factory=list)
    phase: Literal['video', 'sound', 'postproduction'] | None = None
    condition: str | None = None
    reason: str
    has_content: bool = True


class SceneRelationshipGraph(Contract):
    """与读取的版本修订一同生成的只读关系投影。"""

    version_id: Identity
    revision: int = Field(gt=0)
    nodes: list[RelationshipNode]
    edges: list[RelationshipEdge]
    paths: list[RelationshipPath]
    uses: list[RelationshipUse]
    applicability: list[DesignApplicability]
    complete: bool = False
    issues: list[DesignScopeIssue] = Field(default_factory=list)
    preparation_issues: list[DesignScopeIssue] = Field(default_factory=list)
