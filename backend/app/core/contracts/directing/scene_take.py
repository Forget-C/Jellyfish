"""当前场次版本的人工素材判断，与共享生产事实分离。"""
from typing import Literal

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.production import ActualCoverage, TakeAnnotation


class SceneActualCoverage(ActualCoverage):
    """覆盖定位当前方案单元与出现项，不借用原生产计划的动作身份。"""

    unit_id: Identity


class SceneTakeAnnotation(TakeAnnotation):
    """当前方案观察；素材审查和是否剪辑采用仍分别表达。"""

    coverage: list[SceneActualCoverage]


class SceneTakeJudgment(Contract):
    """同一素材在当前版本的独立判断，文件身份必须与原 Take 一致。"""

    take_kind: Literal['production_plan', 'scene_video']
    take_id: Identity
    file_id: Identity
    annotation: SceneTakeAnnotation
