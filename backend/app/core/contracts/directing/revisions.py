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
    created_at: datetime | None = Field(default=None, description="版本最初创建时间；不随草稿保存或确认改变")
    display_number: int | None = Field(default=None, gt=0, description="指令在固定计划与单元内的稳定编号；其他版本不使用")
    confirmed_by: Identity | None
    confirmed_at: datetime | None
    source_current: bool = True
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
SequenceCutRevision = RevisionSnapshot[SequenceCut]


class ReviewPacketRevision(RevisionSnapshot[ReviewPacket]):
    """模型检查应用一次后固定原任务身份；人工派生版本不占用原任务身份。"""

    source_task_id: Identity | None = None


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
    display_number: int | None = Field(default=None, gt=0, description="候选在固定计划与单元内的稳定编号")
    annotation: TakeAnnotation
