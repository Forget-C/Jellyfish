"""导入请求模型（schemas 层）。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.crypto_animal_studio.schemas.episode_package import EpisodePackage


class ImportEpisodeRequest(BaseModel):
    """POST /api/v1/crypto-animal-studio/import 的请求体。"""

    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(..., min_length=1, description="目标 Jellyfish 项目 ID（系列/季）")
    episode_package: EpisodePackage = Field(..., description="待导入的 EpisodePackage（严格校验）")
    dry_run: bool = Field(False, description="为真时只校验/映射/复用查找/告警，不写库")
    idempotency_key: str = Field(..., min_length=1, description="幂等键")


__all__ = ["ImportEpisodeRequest"]
