"""生产 API 的请求/响应模型。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.crypto_animal_studio.schemas.episode_package import (
    EPISODE_PACKAGE_UNION_MODE,
    AnyEpisodePackage,
)


class CreateProductionJobRequest(BaseModel):
    """POST /production/jobs 请求体。"""

    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(..., min_length=1, description="项目 ID")
    episode_package: AnyEpisodePackage = Field(
        ...,
        union_mode=EPISODE_PACKAGE_UNION_MODE,
        description="待生产的 EpisodePackage（严格校验；接受 schema_version 1.0 或 1.1）",
    )
    mode: Literal["mock"] = Field("mock", description="供应商模式；本冲刺仅支持 mock")


class RetryProductionJobRequest(BaseModel):
    """POST /production/jobs/{job_id}/retry 请求体。"""

    model_config = ConfigDict(extra="forbid")

    episode_package: AnyEpisodePackage = Field(
        ...,
        union_mode=EPISODE_PACKAGE_UNION_MODE,
        description="与原任务一致的 EpisodePackage（用于重跑；接受 schema_version 1.0 或 1.1）",
    )
    mode: Literal["mock"] = Field("mock", description="供应商模式；本冲刺仅支持 mock")


class ProductionShotView(BaseModel):
    """生产镜头视图。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    source_shot_id: str
    sequence: int
    status: str
    current_stage: str
    duration_seconds: float
    error_message: str


class ProductionArtifactView(BaseModel):
    """产物视图。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    production_shot_id: str | None
    artifact_type: str
    stage: str
    provider: str
    provider_model: str
    file_path: str
    mime_type: str
    checksum: str


class ProductionJobView(BaseModel):
    """生产任务视图。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    project_id: str
    episode_id: str
    status: str
    current_stage: str
    provider_mode: str
    episode_package_hash: str
    output_path: str
    error_message: str
    started_at: str | None = None
    completed_at: str | None = None
    shots: list[ProductionShotView] = Field(default_factory=list)
    manifest_path: str | None = None
    final_output: str | None = None


__all__ = [
    "CreateProductionJobRequest",
    "RetryProductionJobRequest",
    "ProductionJobView",
    "ProductionShotView",
    "ProductionArtifactView",
]
