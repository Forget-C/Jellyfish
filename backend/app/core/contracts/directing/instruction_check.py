"""可编辑场次单元的固定输入检查，不借用旧提示词版本身份。"""
from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity, ROLES, Text
from app.core.contracts.directing.instruction_basis import InstructionInputs
from app.core.contracts.directing.production import ReviewRow
from app.core.contracts.directing.scene_version import SceneVersionContent


class InstructionCheckRequest(Contract):
    """一次明确检查固定正文、依据与请求身份。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    content: SceneVersionContent
    model_id: Identity | None = None


class InstructionDestination(Contract):
    """固定投影中一项视频要求在最终正文或实际参考中的去向。"""

    owner: str
    field: str
    coverage_item_ids: list[Identity]
    destination: Literal['instruction', 'reference', 'unresolved']
    instruction_excerpt: str | None = None
    reference_id: Identity | None = None
    rationale: Text


class InstructionCheckResult(Contract):
    """六岗逐覆盖项检查；结论不能授权生成或修改正文。"""

    unit_id: Identity
    rows: list[ReviewRow] = Field(min_length=1)
    destinations: list[InstructionDestination] | None = None

    def validate_scope(self, unit_id, coverage_ids, *, scope=None, instruction=None, references=(),
                       require_destinations=False):
        """检查结果必须恰好覆盖固定清单，不能漏项、重复或仍为待检查。"""
        pairs = [(row.role, row.occurrence_id) for row in self.rows]
        expected = {(role, coverage_id) for role in ROLES for coverage_id in coverage_ids}
        if self.unit_id != unit_id or len(pairs) != len(expected) or set(pairs) != expected:
            raise ValueError('检查结果改变了单元或六岗覆盖清单')
        if any(row.verdict == 'pending' for row in self.rows):
            raise ValueError('指令检查尚未完成')
        if require_destinations:
            if scope is None:
                raise ValueError('缺少固定单元范围，无法核对视频要求去向')
            if self.destinations is None:
                raise ValueError('检查结果缺少视频要求的逐项去向')
            required = [use for use in [*scope.execution, *scope.constraints]
                        if use.phase == 'video' and use.text.strip()]
            expected_uses = [(use.owner, use.field, tuple(use.coverage_item_ids)) for use in required]
            actual_uses = ([(row.owner, row.field, tuple(row.coverage_item_ids))
                            for row in self.destinations] if self.destinations is not None else [])
            if len(actual_uses) != len(expected_uses) or set(actual_uses) != set(expected_uses):
                missing = [f'{owner}.{field}' for owner, field, ids in expected_uses
                           if (owner, field, ids) not in actual_uses]
                raise ValueError('检查结果遗漏或改变了视频要求的逐项去向：' + '、'.join(missing or ['身份不一致']))
            bound = {row.id: row for row in references}
            for use, row in zip(required, self.destinations):
                if (use.owner, use.field, tuple(use.coverage_item_ids)) != (
                    row.owner, row.field, tuple(row.coverage_item_ids)):
                    raise ValueError('检查去向顺序与固定输入不一致')
                if row.destination == 'instruction':
                    if (not row.instruction_excerpt or not row.instruction_excerpt.strip()
                            or row.instruction_excerpt not in instruction or row.reference_id):
                        raise ValueError(f'{use.owner}.{use.field} 正文去向必须引用实际指令片段')
                elif row.destination == 'reference':
                    allowed_purposes = ({'space', 'composition'} if use.owner == 'space' else
                                        {'composition', 'space'} if use.owner.startswith('camera:') else
                                        {'continuity'} if use.owner.startswith('continuity:') else
                                        {'identity'} if use.owner.startswith('participant:') else set())
                    binding = bound.get(row.reference_id)
                    identity_matches = (not use.owner.startswith('participant:') or
                                        (binding is not None and use.owner.split(':', 1)[1] in binding.participant_ids))
                    if (use in scope.execution or binding is None or row.instruction_excerpt
                            or binding.purpose not in allowed_purposes or not identity_matches):
                        raise ValueError(f'{use.owner}.{use.field} 参考去向必须引用实际绑定且用途匹配的素材；动作须由正文表达')
                elif row.instruction_excerpt or row.reference_id:
                    raise ValueError('未解决去向不能引用正文或素材')
        return self


class InstructionCheckRead(Contract):
    """固定历史记录；成功结果仍须用户查看和核对适用性。"""

    task_id: Identity
    origin_version_id: Identity
    request_id: Identity
    status: str
    error: str | None
    instruction: Text
    inputs: InstructionInputs
    model_name: str
    result: InstructionCheckResult | None


class InstructionCheckComparison(Contract):
    """当前输入匹配与依据确认分别表达，均不等于已查看结果或可生成。"""

    task_id: Identity
    matches_current: bool
    basis_current: bool
    confirmed: bool


class InstructionCheckConfirmation(Contract):
    """明确核对后返回待绑定的真实检查身份，绑定仍随当前版本保存与撤销。"""

    task_id: Identity
