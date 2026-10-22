"""整场验收结论，不依赖场次完整读模型。"""
from typing import Literal
from pydantic import Field, model_validator
from app.core.contracts.directing.common import Contract, Identity, Text, unique


class SceneCutIssue(Contract):
    """问题定位固定剪辑中的采用身份，不按共享 Take 推断唯一片段。"""

    id: Identity
    severity: Literal['required', 'optional', 'postproduction']
    observation: Text
    acceptance: Text
    clip_ids: list[Identity] = Field(default_factory=list)


class SceneCutReviewDecision(Contract):
    """人工画面结论与覆盖核对、声音状态分别表达。"""

    verdict: Literal['pass', 'revise']
    overall: Text
    established: str = ''
    coverage_status: Literal['unknown', 'gaps', 'verified']
    coverage_notes: str = ''
    issues: list[SceneCutIssue] = Field(default_factory=list)
    sound_status: Literal['pending_postproduction', 'reviewed', 'not_applicable']
    sound_notes: str = ''

    @model_validator(mode='after')
    def judgment(self):
        """缺口未核实或存在必修项不能通过；覆盖及声音确认必须说明依据。"""
        unique([item.id for item in self.issues], 'cut issue')
        if self.verdict == 'pass' and (self.coverage_status != 'verified' or any(item.severity == 'required' for item in self.issues)):
            raise ValueError('覆盖未核实、存在缺口或必修问题，不能验收通过')
        if self.coverage_status != 'unknown' and not self.coverage_notes.strip():
            raise ValueError('覆盖核对须填写实际观察依据')
        if self.sound_status != 'pending_postproduction' and not self.sound_notes.strip():
            raise ValueError('声音审查或不适用须填写依据')
        return self
