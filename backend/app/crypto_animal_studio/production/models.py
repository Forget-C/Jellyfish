"""CAS 生产流水线 ORM 模型（生产状态，独立于创作域模型）。

边界说明：
- 这些表**只记录生产运行状态与产物**，不复制 Jellyfish 的 Project/Chapter/Shot/Asset 等创作实体；
  ``ProductionShot.source_shot_id`` 只保存 EpisodePackage 中的 shot_id（弱引用），
  绝不取代或重复创作侧的 Shot 模型。
- 复用 Jellyfish 的 ``Base`` 与 ``TimestampMixin``；表结构由
  `backend/sql/010-add-cas-production-tables.sql` 迁移创建。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin


class CasProductionJob(Base, TimestampMixin):
    """一次生产运行（对应一个 EpisodePackage）。"""

    __tablename__ = "cas_production_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="任务 ID（UUID）")
    project_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True, comment="项目 ID")
    episode_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True, comment="Episode ID")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", comment="任务状态")
    current_stage: Mapped[str] = mapped_column(String(32), nullable=False, default="validate", comment="当前阶段")
    episode_package_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="EpisodePackage 规范化哈希")
    provider_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="mock", comment="供应商模式（本冲刺仅 mock）")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="开始时间")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="完成时间")
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="错误信息")
    output_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="", comment="任务输出根目录")

    shots: Mapped[list["CasProductionShot"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", passive_deletes=True, order_by="CasProductionShot.sequence"
    )
    artifacts: Mapped[list["CasProductionArtifact"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (Index("ix_cas_prod_jobs_project_episode", "project_id", "episode_id"),)


class CasProductionShot(Base, TimestampMixin):
    """单个镜头的生产状态（仅生产态，不替代创作 Shot）。"""

    __tablename__ = "cas_production_shots"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="生产镜头 ID（UUID）")
    job_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("cas_production_jobs.id", ondelete="CASCADE"), nullable=False, index=True, comment="所属任务"
    )
    source_shot_id: Mapped[str] = mapped_column(String(255), nullable=False, comment="EpisodePackage 中的 shot_id（弱引用）")
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, comment="镜头顺序")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", comment="镜头生产状态")
    current_stage: Mapped[str] = mapped_column(String(32), nullable=False, default="validate", comment="当前阶段")
    image_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="图像提示词")
    negative_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="反向提示词")
    video_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="视频提示词")
    duration_seconds: Mapped[float] = mapped_column(nullable=False, default=0.0, comment="镜头时长（秒）")
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="错误信息")

    job: Mapped["CasProductionJob"] = relationship(back_populates="shots")

    __table_args__ = (Index("ix_cas_prod_shots_job_sequence", "job_id", "sequence"),)


class CasProductionArtifact(Base, TimestampMixin):
    """一次生产产生的产物记录（Artifact First 的落点）。"""

    __tablename__ = "cas_production_artifacts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="产物 ID（UUID）")
    job_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("cas_production_jobs.id", ondelete="CASCADE"), nullable=False, index=True, comment="所属任务"
    )
    production_shot_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("cas_production_shots.id", ondelete="CASCADE"), nullable=True, index=True, comment="所属生产镜头（可空：任务级产物）"
    )
    artifact_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True, comment="产物类型")
    stage: Mapped[str] = mapped_column(String(32), nullable=False, comment="产生该产物的阶段")
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="供应商标识")
    provider_model: Mapped[str] = mapped_column(String(128), nullable=False, default="", comment="供应商模型标识")
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False, comment="产物文件路径（相对存储根）")
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False, default="", comment="MIME 类型")
    checksum: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="文件 SHA-256")
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict, comment="附加元信息")

    job: Mapped["CasProductionJob"] = relationship(back_populates="artifacts")

    __table_args__ = (Index("ix_cas_prod_artifacts_job_type", "job_id", "artifact_type"),)


__all__ = ["CasProductionJob", "CasProductionShot", "CasProductionArtifact"]
