"""LLM/供应商/Agent/模型配置相关的数据库模型。

注释约定：
- 只解释约束/设计取舍（例如单例表、敏感字段、级联策略），避免重复字段名含义。
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin


class AgentTypeKey(str, Enum):
    """Agent 类型（用于工作流编排/能力分类）。"""

    plot = "plot"
    character = "character"
    scene = "scene"
    prop = "prop"
    other = "other"


class ProviderStatus(str, Enum):
    """供应商启用状态。"""

    active = "active"
    testing = "testing"
    disabled = "disabled"


class ModelCategoryKey(str, Enum):
    """模型类别：文本/图片/视频。"""

    text = "text"
    image = "image"
    video = "video"


class LogLevel(str, Enum):
    """全局日志级别。"""

    debug = "debug"
    info = "info"
    warn = "warn"
    error = "error"


class Provider(Base, TimestampMixin):
    """模型供应商配置。

    安全提示：
    - `api_key` / `api_secret` 属敏感信息；如后续接入审计/日志，避免明文输出。
    """

    __tablename__ = "providers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="供应商 ID")
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True, comment="供应商名称")
    base_url: Mapped[str] = mapped_column(String(1024), nullable=False, comment="文本/通用 API Base URL")
    image_base_url: Mapped[str | None] = mapped_column(
        String(1024),
        nullable=True,
        default=None,
        comment="图片能力 API Base URL（可选覆盖）",
    )
    video_base_url: Mapped[str | None] = mapped_column(
        String(1024),
        nullable=True,
        default=None,
        comment="视频能力 API Base URL（可选覆盖）",
    )
    api_key: Mapped[str] = mapped_column(String(4096), nullable=False, default="", comment="API Key（敏感）")
    api_secret: Mapped[str] = mapped_column(String(4096), nullable=False, default="", comment="API Secret（敏感）")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="说明")
    status: Mapped[ProviderStatus] = mapped_column(
        String(32),
        nullable=False,
        default=ProviderStatus.testing,
        comment="状态",
    )
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="创建人")

    models: Mapped[list["Model"]] = relationship(
        back_populates="provider",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_providers_updated_at", "updated_at"),
        Index("ix_providers_status", "status"),
    )


class Model(Base, TimestampMixin):
    """具体模型实例（绑定供应商、类别与参数）。"""

    __tablename__ = "models"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="模型 ID")
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True, comment="模型名称")
    category: Mapped[ModelCategoryKey] = mapped_column(String(16), nullable=False, index=True, comment="模型类别")
    provider_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("providers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属供应商 ID",
    )
    params: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict, comment="模型参数（JSON）")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="说明")
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="创建人")

    provider: Mapped["Provider"] = relationship(back_populates="models")

    __table_args__ = (
        Index("ix_models_updated_at", "updated_at"),
    )


class ModelSettings(Base):
    """模型管理全局设置（单例表）。

    说明：
    - 通过“单表单行”实现全局默认值；应用层通常只读/更新 id=1。
    - 外键使用 `SET NULL`，避免删除模型时导致设置表不可更新。
    """

    __tablename__ = "model_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="设置行 ID（通常为 1）")
    default_text_model_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("models.id", ondelete="SET NULL"),
        nullable=True,
        comment="默认文本模型 ID",
    )
    fallback_text_model_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("models.id", ondelete="SET NULL"),
        nullable=True,
        comment="文本模型失败回退模型 ID（全局统一；空表示关闭回退）",
    )
    default_image_model_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("models.id", ondelete="SET NULL"),
        nullable=True,
        comment="默认图片模型 ID",
    )
    default_video_model_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("models.id", ondelete="SET NULL"),
        nullable=True,
        comment="默认视频模型 ID",
    )
    api_timeout: Mapped[int] = mapped_column(Integer, nullable=False, default=30, comment="API 超时（秒）")
    log_level: Mapped[LogLevel] = mapped_column(String(16), nullable=False, default=LogLevel.info, comment="日志级别")

    default_text_model: Mapped["Model | None"] = relationship(foreign_keys=[default_text_model_id])
    fallback_text_model: Mapped["Model | None"] = relationship(foreign_keys=[fallback_text_model_id])
    default_image_model: Mapped["Model | None"] = relationship(foreign_keys=[default_image_model_id])
    default_video_model: Mapped["Model | None"] = relationship(foreign_keys=[default_video_model_id])
