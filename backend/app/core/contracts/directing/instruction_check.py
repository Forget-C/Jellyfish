"""可编辑场次单元的固定输入检查，不借用旧提示词版本身份。"""
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


class InstructionCheckResult(Contract):
    """六岗逐覆盖项检查；结论不能授权生成或修改正文。"""

    unit_id: Identity
    rows: list[ReviewRow] = Field(min_length=1)

    def validate_scope(self, unit_id, coverage_ids):
        """检查结果必须恰好覆盖固定清单，不能漏项、重复或仍为待检查。"""
        pairs = [(row.role, row.occurrence_id) for row in self.rows]
        expected = {(role, coverage_id) for role in ROLES for coverage_id in coverage_ids}
        if self.unit_id != unit_id or len(pairs) != len(expected) or set(pairs) != expected:
            raise ValueError('检查结果改变了单元或六岗覆盖清单')
        if any(row.verdict == 'pending' for row in self.rows):
            raise ValueError('指令检查尚未完成')
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
