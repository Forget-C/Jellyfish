"""导入结果模型（application 层）。

作为导入服务的返回值，也直接用于 API 响应的 data 部分。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ImportCounts(BaseModel):
    """各类实体的计数（created 或 reused 各一份）。"""

    model_config = ConfigDict(extra="forbid")

    chapters: int = 0
    shots: int = 0
    shot_details: int = 0
    dialog_lines: int = 0
    characters: int = 0
    actors: int = 0
    scenes: int = 0
    props: int = 0
    costumes: int = 0
    links: int = 0


class SubtitleArtifact(BaseModel):
    """一条字幕产物（WebVTT）在导入结果中的表示。"""

    model_config = ConfigDict(extra="forbid")

    file_id: str = Field(..., description="Jellyfish files.id")
    language_tag: str = Field(..., description="BCP 47 语言标签，如 zh-Hant")
    storage_key: str = Field(..., description="对象存储 key（确定性）")
    cue_count: int = Field(..., description="cue 数量")
    byte_size: int = Field(..., description="WebVTT 字节数")
    created: bool = Field(..., description="true=本次新建；false=复用既有产物并就地更新")


class ImportResult(BaseModel):
    """一次导入（或 dry-run / 重放）的结果摘要。"""

    model_config = ConfigDict(extra="forbid")

    status: str = Field(..., description="imported | dry_run | replayed")
    dry_run: bool = Field(..., description="是否为 dry-run（未写库）")
    idempotent_replay: bool = Field(..., description="是否命中幂等重放（返回既有结果）")
    project_id: str
    episode_id: str
    idempotency_key: str
    payload_hash: str = Field(..., description="EpisodePackage 规范化 SHA-256")
    chapter_id: str | None = Field(None, description="产生/既有的 Chapter ID；dry-run 为 null")
    chapter_index: int | None = Field(None, description="Chapter 在项目内的序号；dry-run 为拟用序号")
    created: ImportCounts = Field(default_factory=ImportCounts, description="本次新建计数")
    reused: ImportCounts = Field(default_factory=ImportCounts, description="本次复用计数")
    warnings: list[str] = Field(default_factory=list, description="非阻断告警（不丢弃数据）")
    subtitle_artifacts: list[SubtitleArtifact] = Field(
        default_factory=list,
        description="本次导入生成/复用的字幕产物（WebVTT）；v1 文档为空列表",
    )


__all__ = ["ImportResult", "ImportCounts", "SubtitleArtifact"]
