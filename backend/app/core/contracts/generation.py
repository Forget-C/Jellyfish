"""统一生成编排的外部请求、内部命令与冻结快照契约。"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.contracts.asset_prompts import AssetPromptAudit
from app.core.contracts.media import ImageMediaInput, VideoMediaInput
from app.core.contracts.text_generation import ScriptOperationInput, TextChatInput


class GenerationModality(str, Enum):
    """生成结果的模态。"""

    text = "text"
    image = "image"
    video = "video"


class GenerationDelivery(str, Enum):
    """调用方接收生成结果的固定交付协议。"""

    inline = "inline"
    streaming = "streaming"
    async_polling = "async_polling"


class GenerationTargetKind(str, Enum):
    """受信任业务目标的封闭集合。"""

    experiment_session = "experiment_session"
    asset_image_slot = "asset_image_slot"
    shot_frame_slot = "shot_frame_slot"
    shot_video = "shot_video"
    directing_unit = "directing_unit"
    shot_detail = "shot_detail"
    script_processing = "script_processing"


class GenerationOperation(str, Enum):
    """由路由 Binder 派生的生成 operation。"""

    text_chat = "text_chat"
    text_agent = "text_agent"
    image_generation = "image_generation"
    video_generation = "video_generation"


class GenerationTarget(BaseModel):
    """仅内部命令使用的可信业务目标。"""

    model_config = ConfigDict(extra="forbid")

    kind: GenerationTargetKind
    entity_id: str = Field(min_length=1)
    slot_id: str | None = None
    asset_type: Literal["actor", "character", "scene", "prop", "costume"] | None = None

    @model_validator(mode="after")
    def require_asset_type(self) -> "GenerationTarget":
        """资产槽位必须保留路径类别，不能用不同表中可能重复的数字 ID 猜测。"""
        if self.kind == GenerationTargetKind.asset_image_slot and self.asset_type is None:
            raise ValueError("asset image target requires asset_type")
        return self


class ImageGenerationOperationInput(BaseModel):
    """图片 operation 的可执行参数，不承载媒体 URL 或业务目标。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["image_generation"] = "image_generation"
    target_ratio: str | None = None
    resolution_profile: str | None = None
    count: int = Field(default=1, ge=1, le=10)
    save_as_candidate: bool = Field(False, description="资产图仅保存候选结果，不自动替换槽位")


class VideoGenerationOperationInput(BaseModel):
    """视频 operation 的可执行参数，不承载媒体 URL 或业务目标。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["video_generation"] = "video_generation"
    ratio: str
    seconds: int | None = Field(default=None, ge=1)
    seed: int | None = None


TypedOperationInput = Annotated[
    TextChatInput | ScriptOperationInput | ImageGenerationOperationInput | VideoGenerationOperationInput,
    Field(discriminator="kind"),
]


class GenerationSubmitRequest(BaseModel):
    """业务路由接收的请求；目标、模态、operation 与 delivery 由路径决定。"""

    model_config = ConfigDict(extra="forbid")

    model_id: str | None = None
    execution_prompt: str | None = None
    media: ImageMediaInput | VideoMediaInput | None = None
    render_id: str | None = None
    asset_prompt_audit: AssetPromptAudit | None = None
    operation_input: TypedOperationInput

    @model_validator(mode="after")
    def require_prompt_for_prompt_operations(self) -> "GenerationSubmitRequest":
        """单提示词 operation 必须显式冻结最终提示词，聊天与 Agent 不使用伪 prompt。"""
        if isinstance(self.operation_input, (ImageGenerationOperationInput, VideoGenerationOperationInput)):
            if not self.execution_prompt or not self.execution_prompt.strip():
                raise ValueError("execution_prompt is required for image and video generation")
        if self.asset_prompt_audit is not None:
            audit = self.asset_prompt_audit
            references = self.media.references if isinstance(self.media, ImageMediaInput) else []
            if self.execution_prompt != audit.execution_prompt or [ref.file_id for ref in references] != audit.reference_file_ids:
                raise ValueError("资产预览与提交的提示词或参考图不一致，请更新预览")
        return self


class GenerationCommand(BaseModel):
    """Binder 交给 Submitter 的完整内部命令。"""

    model_config = ConfigDict(extra="forbid")

    modality: GenerationModality
    operation: GenerationOperation
    delivery: GenerationDelivery
    target: GenerationTarget
    request: GenerationSubmitRequest


class ResolvedGenerationSnapshot(BaseModel):
    """Entity Gate 生成的异步任务参数快照，绝不保存凭据或模型配置副本。

    Worker 会在真正执行时按 ``model_id`` 读取当前模型与 Provider 配置；快照只
    保存用户提交的输入，避免待执行任务因模型管理更新而被阻塞。
    """

    model_config = ConfigDict(extra="forbid")

    model_id: str
    canonical_target: GenerationTarget
    expected_version_id: int | None = Field(default=None, ge=1)
    prompt_revision_id: str | None = None
    media: ImageMediaInput | VideoMediaInput | None = None
    operation_input: TypedOperationInput
    execution_prompt: str | None = None
    asset_prompt_audit: AssetPromptAudit | None = None
