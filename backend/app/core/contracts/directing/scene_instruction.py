"""当前单元指令的冻结请求、模型结果和明确应用前的预览。"""
from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity, Source, Text
from app.core.contracts.directing.scene_version import EditableGenerationUnit, EditableSceneDesign, SceneVersionContent, SceneVersionSource
from app.core.contracts.directing.style import StyleRule


class SceneInstructionScope(Contract):
    """正文的半开 Unicode 字符范围，禁止按相同文字猜测目标位置。"""

    start: int = Field(ge=0, strict=True)
    end: int = Field(gt=0, strict=True)

    def validate_text(self, before: str, after: str | None = None):
        """校验固定范围及范围外文字；越界结果整次拒绝。"""
        if not self.start < self.end <= len(before):
            raise ValueError('指令修订范围无效，请重新选择正文中的文字')
        if after is not None:
            prefix, suffix = before[:self.start], before[self.end:]
            if len(after) < len(prefix) + len(suffix) or not after.startswith(prefix) or not after.endswith(suffix):
                raise ValueError('建议修改了限定范围外的正文，整次拒绝应用')


class SceneInstructionRequest(Contract):
    """同一次点击保留请求身份和当前输入，提交不保存或执行视频。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    content: SceneVersionContent
    model_id: Identity | None = None
    requirements: str = Field(default='', max_length=12000)
    scope: SceneInstructionScope | None = None


class SceneInstructionResult(Contract):
    """模型只能返回指定单元的正文，不能变更设计、引用或其他单元。"""

    unit_id: Identity
    text: Text


class SceneInstructionSuggestionRead(Contract):
    """任务真实状态与固定输入；没有结果时正文为空，不伪造空建议。"""

    task_id: Identity
    request_id: Identity
    status: str
    error: str | None
    requirements: str
    scope: SceneInstructionScope | None = None
    basis: SceneVersionSource
    design: EditableSceneDesign
    unit: EditableGenerationUnit
    generation_model_id: str | None
    generation_model_name: str | None
    video_model_name: str | None
    style_rules: list[StyleRule] | None
    text: str | None


class SceneInstructionPreview(SceneInstructionResult):
    """重新核实后的完整正文，来源指向真实任务；预览不改写原单元。"""

    task_id: Identity
    source: Source


class SceneInstructionApply(SceneInstructionPreview):
    """明确应用时返回正文、来源和不可变依据回执，供一次编辑共同采用。"""

    basis_id: Identity
