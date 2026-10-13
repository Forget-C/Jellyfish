"""当前场次版本的视频执行预检，不携带前端另拼的执行输入。"""
from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.instruction_basis import InstructionInputs
from app.core.contracts.directing.scene_version import SceneVersionSave, SceneVersionRead
from app.core.contracts.directing.production import TakeAnnotation
from app.core.contracts.generation import GenerationSubmitRequest


class SceneVideoPrepareRequest(Contract):
    """先完成保存，再按明确保存修订核验当前内容。"""

    expected_revision: int = Field(gt=0)


class SceneVideoPreparation(Contract):
    """只读核验的实际执行输入；不创建任务，也不构成之后提交的通行凭据。"""

    version_id: Identity
    unit_id: Identity
    revision: int
    check_task_id: Identity
    inputs: InstructionInputs
    request: GenerationSubmitRequest


class SceneVideoSubmitRequest(SceneVideoPrepareRequest):
    """原请求身份不变；可绑定明确预检输入，提交时重新核对相关内容。"""

    request_id: Identity
    expected_preparation: SceneVideoPreparation | None = None


class SceneTakeRead(Contract):
    """真实输出登记，审片与实际覆盖初始均为空，不包含自动采用语义。"""

    id: Identity
    file_id: Identity
    output_ordinal: int
    annotation: TakeAnnotation


class SceneVideoRead(Contract):
    """原版本单元的固定执行和实时任务状态，候选来自真实输出。"""

    execution_id: Identity
    task_id: Identity
    request_id: Identity
    status: str
    cancel_requested: bool = False
    error: str | None
    retry_of_task_id: Identity | None = None
    preparation: SceneVideoPreparation
    takes: list[SceneTakeRead]


class SceneVideoSaveRequest(Contract):
    """点击时固定待保存内容与视频请求；后续编辑不能替换这份输入。"""

    request_id: Identity
    save: SceneVersionSave


class SceneVideoSaveResult(Contract):
    """保存成功后即使执行受阻也返回保存结果，供界面保留正确基线。"""

    version: SceneVersionRead
    task_id: Identity | None
    error: str | None


class SceneVideoRetryRequest(Contract):
    """原执行重试的独立授权，不携带当前正文或保存修订。"""

    request_id: Identity
