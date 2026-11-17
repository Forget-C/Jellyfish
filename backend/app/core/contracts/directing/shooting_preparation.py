"""生成前场次拍摄说明；仅作参考，与原文事实分开。"""
from typing import Literal
from pydantic import Field, model_validator
from app.core.contracts.directing.common import Contract, Identity, Text


class ShootingNote(Contract):
    """用户维护的场次参考，空摘录表示全场。"""
    id: Identity
    text: Text = Field(max_length=10000)
    excerpt: str = ''
    choice: Literal['adopt', 'delegate', 'skip', 'review'] = 'adopt'
    source: Literal['user', 'check'] = 'user'


class ShootingPreparation(Contract):
    """随场次版本保存的说明与报告引用；报告原文由任务保存。"""
    notes: list[ShootingNote] = Field(default_factory=list, max_length=100)
    check_task_id: Identity | None = None
    check_covered: bool | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode='after')
    def unique_notes(self):
        """避免同一说明身份出现多个含义。"""
        if len({note.id for note in self.notes}) != len(self.notes):
            raise ValueError('场次拍摄说明身份重复')
        return self


class ShootingPreparationSave(Contract):
    """即时保存采用并发版本和幂等身份。"""
    request_id: Identity
    expected_version: int = Field(gt=0)
    preparation: ShootingPreparation


class ShootingCheckRequest(Contract):
    """草稿可无场次数据库身份；检查冻结实际摘录和说明。"""
    request_id: Identity
    draft_key: Identity
    source_text: Text = Field(max_length=100000)
    preparation: ShootingPreparation = Field(default_factory=ShootingPreparation)
    source_version: str | None = None
    source_start: int | None = Field(default=None, ge=0)
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
