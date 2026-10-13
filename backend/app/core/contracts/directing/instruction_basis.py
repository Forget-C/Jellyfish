"""正文依据的明确确认和只读比较；确认不等于检查通过。"""
from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.scene_version import EditableSceneDesign, EditableUnitPreparation, SceneVersionContent, SceneVersionSource
from app.core.contracts.directing.style import StyleRule


class InstructionInputs(Contract):
    """只包含相关依据，正文和来源单独记录，其他单元与输出画幅不参与比较。"""

    basis: SceneVersionSource
    design: EditableSceneDesign
    unit: EditableUnitPreparation
    video_model_name: str | None
    style_rules: list[StyleRule]


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
