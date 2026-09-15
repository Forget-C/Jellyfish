"""三本账只读聚合已有事实，绝不接受台账回写。"""
from datetime import datetime
from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.continuity import ContinuityRead
from app.core.contracts.directing.feedback import FeedbackRead
from app.core.contracts.directing.workspace import WorkspaceRead


class LedgerAction(Contract):
    """公开批准动作的显示文案、版本、任务和人，不暴露供应商凭据。"""

    revision_id: Identity
    review_revision_id: Identity | None
    action: str
    actor_id: str
    displayed_label: str
    unit_id: Identity
    task_id: Identity | None
    created_at: datetime


class LedgerExecution(Contract):
    """仅公开实际冻结的模型身份和视频参数，不暴露供应商凭据。"""

    task_id: Identity
    status: str
    model_name: str | None
    provider_key: str | None
    ratio: str | None
    seconds: int | None
    seed: int | None
    snapshot_available: bool


class LedgerRead(Contract):
    """设计、提示词、输入、产出、观察及返工关系的一次只读查询。"""

    workspace: WorkspaceRead
    continuity: ContinuityRead
    feedback: FeedbackRead
    actions: list[LedgerAction]

    executions: list[LedgerExecution]
