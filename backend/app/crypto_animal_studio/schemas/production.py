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
    mode: Literal["mock", "render"] = Field(
        "mock",
        description=(
            "供应商模式：mock=Step 6 的确定性模拟流水线（行为完全不变）；"
            "render=Step 7 单镜头真实渲染，需显式选择，绝不由 mock 隐式转真"
        ),
    )


class RetryProductionJobRequest(BaseModel):
    """POST /production/jobs/{job_id}/retry 请求体。"""

    model_config = ConfigDict(extra="forbid")

    episode_package: AnyEpisodePackage = Field(
        ...,
        union_mode=EPISODE_PACKAGE_UNION_MODE,
        description="与原任务一致的 EpisodePackage（用于重跑；接受 schema_version 1.0 或 1.1）",
    )
    mode: Literal["mock", "render"] = Field("mock", description="供应商模式；用于重跑")


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
    """产物视图。

    Step 7 追加的字段全部可选，因此 Step 6 的响应形状依然合法。
    ``download_url`` 复用既有的受控文件端点，不新开公开静态路由。
    """

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

    # --- Step 7 追加（可选） ---
    file_id: str | None = Field(None, description="对应的 Jellyfish FileItem.id（对象存储产物）")
    size_bytes: int | None = Field(None, description="字节数；仅在存储层能提供时才有值")
    download_url: str | None = Field(
        None,
        description="播放/下载地址，复用既有 /api/v1/studio/files/{file_id}/download 受控端点",
    )
    provider_job_id: str | None = Field(None, description="供应商侧任务/prompt ID（可安全展示）")
    attempt: int | None = Field(None, description="产生该产物的尝试序号")


class RenderTaskView(BaseModel):
    """当前/最近一次渲染尝试的任务视图（由任务中心派生，不新增数据库列）。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str
    status: str = Field(..., description="pending/running/streaming/succeeded/failed/cancelled")
    progress: int | None = Field(None, description="0-100；供应商不暴露进度时为 null")
    stage_message: str | None = Field(None, description="安全的阶段文案")
    provider_task_id: str | None = Field(None, description="供应商任务 ID（成功后可得）")
    error_reason: str | None = Field(None, description="安全的失败原因；绝不含堆栈或凭据")
    attempt: int | None = Field(None, description="尝试序号")
    is_terminal: bool = Field(..., description="是否已到终态（前端据此停止轮询）")


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

    # --- Step 7 追加（可选）：最近一次渲染尝试，按 created_at desc, id desc 确定性选取 ---
    render_task: RenderTaskView | None = Field(
        None, description="该任务下最近一次 cas_shot_render 尝试；无渲染尝试时为 null"
    )


__all__ = [
    "CreateProductionJobRequest",
    "RetryProductionJobRequest",
    "ProductionJobView",
    "ProductionShotView",
    "ProductionArtifactView",
    "RenderTaskView",
]
