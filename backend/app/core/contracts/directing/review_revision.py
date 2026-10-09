"""固定指令输入的有限字段替换；人工修改与检查驱动修订均不改变原检查。"""

from typing import Any, Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity, Role, Text
from app.core.contracts.directing.production import CompilationDecision


class RevisionReviewSource(Contract):
    """检查版本或已成功检查任务，不能使用可变列表序号定位来源。"""

    kind: Literal['review', 'task']
    id: Identity


class ReviewDirection(Contract):
    """问题序号仅在该不可变来源内有效，-1 表示无 findings 的整行。"""

    occurrence_id: Identity
    role: Role
    finding_index: int = Field(ge=-1)
    text: str = Field(max_length=8000)
    sound_execution: Literal['generated', 'postproduction'] | None = None


class RevisionFieldTarget(Contract):
    """局部修改的精确字段身份；空范围不代表整体修改。"""

    target: Literal['design', 'unit']
    path: Text


class RevisionEdit(RevisionFieldTarget):
    """人工指定已有字段的精确替换，不代表检查问题。"""

    before: Any
    after: Any


class EditableRevisionField(Contract):
    """服务端限定的字段与固定当前值。"""

    target: Literal['design', 'unit']
    path: Text
    value: Any


class EditableRevisionFields(Contract):
    """指定指令的可编辑字段。"""

    prompt_revision_id: Identity
    fields: list[EditableRevisionField]


class ReviewRevisionRequest(Contract):
    """冻结整体要求、字段编辑和可选检查；请求身份用于恢复响应丢失的任务。"""

    prompt_revision_id: Identity
    review_source: RevisionReviewSource | None = None
    instruction: str = Field(default="", max_length=8000)
    edits: list[RevisionEdit] = Field(default_factory=list, max_length=100)
    scope: list[RevisionFieldTarget] | None = Field(default=None, min_length=1, max_length=100)
    directions: list[ReviewDirection] = Field(default_factory=list, max_length=200)
    model_id: Identity | None = None
    request_id: Identity


class RevisionFieldChange(Contract):
    """只替换服务端列出的已有字段，before 必须等于固定输入。"""

    target: Literal['design', 'unit']
    path: Text
    before: Any
    after: Any
    reason: Text
    problem_keys: list[str] = Field(default_factory=list)


class RevisionDirectionOutcome(Contract):
    """拟落实是模型建议；必要创作选择必须明确呈现。"""

    problem_key: Text
    status: Literal['planned', 'needs_choice', 'unresolved']
    reason: Text
    choices: list[str] = Field(default_factory=list)


class RevisionSummary(Contract):
    """整体修改的结果，不冒充某个检查问题。"""

    status: Literal['planned', 'needs_choice', 'unresolved', 'unchanged']
    reason: Text
    choices: list[str] = Field(default_factory=list)


class ReviewRevisionCandidate(Contract):
    """真实差异、可选问题回应和服务端完整预览，不提供模型自行决定的整份设计。"""

    input_identity: Text
    changes: list[RevisionFieldChange] = Field(default_factory=list, max_length=100)
    summary: RevisionSummary | None = None
    preview_text: str | None = None
    preview_decisions: list[CompilationDecision] | None = None
    candidate_identity: str | None = None
    source_prompt_revision_id: Identity | None = None
    outcomes: list[RevisionDirectionOutcome] = Field(default_factory=list)


class ApplyReviewRevisionRequest(Contract):
    """采用必须回传当前方向和固定身份，不能仅依赖前端禁用按钮。"""

    task_id: Identity
    instruction: str = Field(default="", max_length=8000)
    edits: list[RevisionEdit] = Field(default_factory=list, max_length=100)
    scope: list[RevisionFieldTarget] | None = Field(default=None, min_length=1, max_length=100)
    candidate_identity: str | None = None
    input_identity: Text
    directions: list[ReviewDirection] = Field(default_factory=list)
    request_id: Identity


class ReviewRevisionApplication(Contract):
    """已持久化步骤身份；失败保留产物，下次同请求继续。"""

    task_id: Identity
    request_id: Identity
    stage: Literal['saved', 'compiled', 'reviewing', 'blocked']
    design_revision_id: Identity | None = None
    plan_revision_id: Identity | None = None
    prompt_revision_id: Identity | None = None
    review_task_id: Identity | None = None
    error: str | None = None
