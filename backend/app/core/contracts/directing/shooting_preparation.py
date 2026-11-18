"""章节拍摄解释与整章拍摄检查。"""
from typing import Literal
from pydantic import Field, model_validator
from app.core.contracts.directing.common import Contract, Identity, Text


class ShootingScope(Contract):
    start: int = Field(ge=0)
    end: int = Field(gt=0)


class ShootingNote(Contract):
    """拍摄参考，适用范围独立于引用依据。"""
    id: Identity
    text: Text = Field(max_length=10000)
    excerpt: str = ''
    scope: ShootingScope | None = None
    previous_scope_text: str = ''
    choice: Literal['adopt', 'delegate', 'skip', 'review'] = 'adopt'
    source: Literal['user', 'check'] = 'user'


class ShootingPreparation(Contract):
    """按原文版本保存的解释与报告引用。"""
    notes: list[ShootingNote] = Field(default_factory=list, max_length=100)
    check_task_id: Identity | None = None
    check_covered: bool | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode='after')
    def unique_notes(self):
        """避免同一说明身份出现多个含义。"""
        if len({note.id for note in self.notes}) != len(self.notes):
            raise ValueError('拍摄解释身份重复')
        return self


class ShootingExplanationSave(Contract):
    source_version: Identity
    request_id: Identity
    expected_version: int = Field(ge=0)
    preparation: ShootingPreparation


class ShootingExplanationRead(Contract):
    source_version: Identity
    version: int = Field(ge=0)
    preparation: ShootingPreparation


class ShootingCheckRequest(Contract):
    request_id: Identity
    source_version: Identity
    preparation: ShootingPreparation = Field(default_factory=ShootingPreparation)
    model_id: Identity | None = None


class ShootingIssue(Contract):
    """生成前疑点，不引用尚不存在的镜头。"""
    id: Identity
    category: Literal['position', 'path', 'visibility', 'continuity', 'source']
    kind: Literal['conflict', 'insufficient_basis', 'optional']
    excerpt: str = ''
    note_id: Identity | None = None
    problem: Text
    suggestion: str = ''


class ShootingCheckReport(Contract):
    issues: list[ShootingIssue] = Field(default_factory=list, max_length=100)


class ShootingCheckRead(Contract):
    task_id: Identity
    status: str
    error: str | None = None
    source_text: str
    preparation: ShootingPreparation
    report: ShootingCheckReport | None = None
    basis_current: bool = True
    previous_scope_text: str = ''
