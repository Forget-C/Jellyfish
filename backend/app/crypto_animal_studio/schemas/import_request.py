"""导入请求模型（schemas 层）。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.crypto_animal_studio.schemas.episode_package import (
    EPISODE_PACKAGE_UNION_MODE,
    AnyEpisodePackage,
)


class ImportEpisodeRequest(BaseModel):
    """POST /api/v1/crypto-animal-studio/import 的请求体。"""

    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(..., min_length=1, description="目标 Jellyfish 项目 ID（系列/季）")
    episode_package: AnyEpisodePackage = Field(
        ...,
        union_mode=EPISODE_PACKAGE_UNION_MODE,
        description="待导入的 EpisodePackage（严格校验；接受 schema_version 1.0 或 1.1）",
    )
    dry_run: bool = Field(False, description="为真时只校验/映射/复用查找/告警，不写库")
    idempotency_key: str = Field(..., min_length=1, description="幂等键")


class CasImportTaskAccepted(BaseModel):
    """POST /import/async 的响应体：任务已受理。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(..., description="任务中心任务 ID")
    status: str = Field(..., description="任务状态（pending/running/...）")
    reused: bool = Field(..., description="是否复用了同一剧集的活动任务")
    task_kind: str = Field(..., description="任务种类（cas_import_episode_package）")
    relation_type: str = Field(..., description="业务关联类型")
    relation_entity_id: str = Field(..., description="业务关联实体键（project+episode 摘要）")


__all__ = ["ImportEpisodeRequest", "CasImportTaskAccepted"]
