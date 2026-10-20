"""正文依据的明确确认和只读比较；确认不等于检查通过。"""
from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity, Source
from app.core.contracts.directing.scene_version import EditableSceneDesign, EditableUnitPreparation, SceneVersionContent, SceneVersionSource
from app.core.contracts.directing.style import StyleRule


class UnitScopeUse(Contract):
    """一项固定输入的原字段、来源与实际纳入原因。"""

    owner: str
    field: str
    text: str
    sources: list[Source]
    reason: str
    coverage_item_ids: list[Identity] = Field(default_factory=list)
    phase: Literal['video', 'sound', 'postproduction'] | None = None
    condition: str | None = None


class UnitScopeProjection(Contract):
    """按单元出现项固定执行、约束与解释背景，不以画布归位推定拍摄范围。"""

    version: int = 1
    execution: list[UnitScopeUse]
    constraints: list[UnitScopeUse]
    background: list[UnitScopeUse]
    unresolved: list[str]

    def same_video_consumption(self, other: 'UnitScopeProjection') -> bool:
        """声音与后期约束保留在快照中，但不使视频正文依据失效。"""
        return (self.version == other.version and self.execution == other.execution
                and [row for row in self.constraints if row.phase == 'video']
                == [row for row in other.constraints if row.phase == 'video']
                and self.background == other.background and self.unresolved == other.unresolved)


class InstructionInputs(Contract):
    """只包含相关依据，正文和来源单独记录，其他单元与输出画幅不参与比较。"""

    basis: SceneVersionSource
    design: EditableSceneDesign
    unit: EditableUnitPreparation
    video_model_name: str | None
    style_rules: list[StyleRule]
    scope: UnitScopeProjection | None = None

    def same_consumption(self, other: 'InstructionInputs') -> bool:
        """新投影比较实际消费；历史无投影记录仍按原冻结结构核对。"""
        if self.scope is None or other.scope is None:
            return self == other
        return (self.basis == other.basis and self.unit == other.unit
                and self.video_model_name == other.video_model_name
                and self.style_rules == other.style_rules
                and self.scope.same_video_consumption(other.scope))


class InstructionBasisConfirm(Contract):
    """显式确认已按本次依据核对正文；原请求可幂等核实。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    content: SceneVersionContent


class InstructionBasisRead(Contract):
    """保留原依据以供差异核对；current 仅代表依据一致，不代表可生成。"""

    basis_id: Identity | None
    status: Literal['empty', 'unbound', 'current', 'changed']
    previous: InstructionInputs | None
    current: InstructionInputs
