"""统一生成终态交付的跨层契约。

本模块位于 Provider 原始结果与业务 Workflow/Finalizer 之间。它只描述已经
归档、可安全展示或发布的产物，不承载临时 URL、Base64 或供应商原始响应。
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.contracts.generation import GenerationModality, ResolvedGenerationSnapshot


class GenerationOutcome(str, Enum):
    """任务终态，供 WorkflowHandler 与 Finalizer 使用同一套收口语义。"""

    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class DeliveredArtifactPublishState(str, Enum):
    """归档产物自动发布到业务目标后的状态。"""

    published = "published"
    conflicted = "conflicted"
    skipped = "skipped"


class DeliveredArtifact(BaseModel):
    """已归档产物的稳定交付视图，避免 API 消费 Provider 临时结果。"""

    model_config = ConfigDict(extra="forbid")

    artifact_id: str = Field(min_length=1)
    modality: GenerationModality
    ordinal: int = Field(ge=0)
    file_id: str | None = None
    text_content: str | None = None
    publish_state: DeliveredArtifactPublishState
    publish_error: str | None = None

    @model_validator(mode="after")
    def require_single_content(self) -> "DeliveredArtifact":
        """确保媒体与文本产物只暴露一种可交付内容。"""
        if (self.file_id is None) == (self.text_content is None):
            raise ValueError("exactly one of file_id or text_content must be set")
        return self


class GenerationDeliveryResult(BaseModel):
    """终态交付的通用结果，供任务轮询与领域展示投影共享。"""

    model_config = ConfigDict(extra="forbid")

    outcome: GenerationOutcome
    artifacts: list[DeliveredArtifact] = Field(default_factory=list)
    primary_file_id: str | None = None
    provider_task_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None

    @model_validator(mode="after")
    def validate_terminal_shape(self) -> "GenerationDeliveryResult":
        """保证失败信息不会伪装为成功交付，并校验主文件来自已交付产物。"""
        if self.outcome is GenerationOutcome.succeeded:
            if self.error_code is not None or self.error_message is not None:
                raise ValueError("succeeded delivery must not include an error")
        elif not self.error_code:
            raise ValueError("failed or cancelled delivery requires error_code")

        file_ids = {artifact.file_id for artifact in self.artifacts if artifact.file_id is not None}
        if self.primary_file_id is not None and self.primary_file_id not in file_ids:
            raise ValueError("primary_file_id must reference a delivered artifact")
        return self


class GenerationTerminalCommand(BaseModel):
    """Finalizer 的唯一终态输入，防止 Worker 直接拼装业务表更新。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)
    snapshot: ResolvedGenerationSnapshot
    delivery_result: GenerationDeliveryResult


__all__ = [
    "DeliveredArtifact",
    "DeliveredArtifactPublishState",
    "GenerationDeliveryResult",
    "GenerationOutcome",
    "GenerationTerminalCommand",
]
