"""项目风格版本与规则适用范围，候选不会隐式成为执行约束。"""

from datetime import datetime
from typing import Literal
from pydantic import Field, model_validator
from app.core.contracts.directing.common import Contract, Identity, Note, Role, Source, Text, unique


class StyleRule(Contract):
    """有来源、例外和范围的可观察规则；空范围表示项目通用。"""

    id: Identity
    role: Role
    requirement: Text
    exceptions: Note = Field(default_factory=Note)
    sequence_ids: list[Identity] = Field(default_factory=list)
    model_names: list[Text] = Field(default_factory=list)
    status: Literal['candidate', 'confirmed', 'deprecated'] = 'candidate'
    sources: list[Source] = Field(min_length=1)


class ProjectStyleProfile(Contract):
    """一份完整项目风格快照，确认后不可原地修改。"""

    title: Text
    rules: list[StyleRule]
    sources: list[Source] = Field(min_length=1)

    @model_validator(mode='after')
    def identities(self):
        """防止同版本规则身份重复。"""
        unique([rule.id for rule in self.rules], 'style rule')
        return self


class StyleWrite(Contract):
    """保存或派生风格草稿，更新必须携带已看到的版本。"""

    content: ProjectStyleProfile
    revision_id: Identity | None = None
    expected_version: int | None = Field(default=None, gt=0)
    parent_id: Identity | None = None


class ProjectStyleRevision(Contract):
    """项目风格的确认身份由服务端返回，不接受模型自称确认。"""

    id: Identity
    project_id: Identity
    parent_id: Identity | None
    version: int
    confirmed_by: Identity | None
    confirmed_at: datetime | None
    content: ProjectStyleProfile
