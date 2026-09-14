"""可跨层传递的版本读契约；确认字段由存储服务提供，不属于模型输入。"""

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import Field, model_validator

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.production import ProductionPlan, Prompt, ReviewPacket, SequenceCut, TakeAnnotation

Content = TypeVar("Content", bound=Contract)


class RevisionSnapshot(Contract, Generic[Content]):
    """同一草稿的 version 用于 CAS；确认后通过新 id 和 parent_id 派生。"""

    id: Identity
    project_id: Identity
    chapter_id: Identity
    sequence_id: Identity
    parent_id: Identity | None
    version: int = Field(gt=0)
    confirmed_by: Identity | None
    confirmed_at: datetime | None
    content: Content

    @model_validator(mode="after")
    def confirmation_pair(self):
        """确认人和时间共同存在，防止构造半确认读模型。"""
        if (self.confirmed_by is None) != (self.confirmed_at is None):
            raise ValueError("confirmation actor and timestamp must agree")
        return self


SceneDesignRevision = RevisionSnapshot[SceneDesign]
ProductionPlanRevision = RevisionSnapshot[ProductionPlan]
PromptRevision = RevisionSnapshot[Prompt]
ReviewPacketRevision = RevisionSnapshot[ReviewPacket]
SequenceCutRevision = RevisionSnapshot[SequenceCut]


class TakeSnapshot(Contract):
    """Take 的不可变身份和可更新审片注释分开表达。"""

    id: Identity
    project_id: Identity
    chapter_id: Identity
    sequence_id: Identity
    prompt_revision_id: Identity
    plan_revision_id: Identity
    unit_id: Identity
    task_id: Identity
    output_ordinal: int = Field(ge=0)
    file_id: Identity
    version: int = Field(gt=0)
    annotation: TakeAnnotation
