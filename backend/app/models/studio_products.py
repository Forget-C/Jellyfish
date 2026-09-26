"""商品资产（第五类资产）的 ORM：``products`` / ``product_images`` / ``project_product_links``。

为什么要新增一类资产（用户 2026-09-25 / 09-26 拍板）
==================================================

「广告剧情流程」要把一个真实商品（面膜、保温杯……）作为**可复用资产**参与生产：
方案确认后落成商品资产，商品定版图作为**帧参考图**参与关键帧生成。

仓库既有四类资产（character / scene / prop / costume）没有一个能承载「商品」语义：

- 复用 ``prop`` 会污染道具语义（道具是剧情里的物件，商品是卖点的载体），
  且后续「卖点剧情化」「包装 / Logo 保真」等规则无处落；
- 新增独立类型是用户明确拍板的选择
  （见 ``site/content/docs/plans/product-drama-plan-integration.md``）。

作用域与 ``prop`` / ``scene`` / ``costume`` 一致：**全局资产**。
三张表里都**不放** ``project_id``，归属完全由 ``project_product_links`` 的三档作用域表达：

- 项目档 = ``chapter_id`` / ``shot_id`` 皆空（这个商品属于本项目）；
- 章节档 = ``shot_id`` 空、``chapter_id`` 有值；
- 镜头档 = 两者都有值（**这一镜里出现了这个商品**，「至少一半镜头」就靠行数判定）。

MVP 边界（别越界）
==================

本文件只提供**数据模型**。出图通道（``costume_channel`` 那种专线）、
工作台平权、出图侧枚举（``asset_strategies`` / ``image_tasks`` / ``asset_prompt_batch`` /
``asset_workbench`` / ``core/task_manager/stores``）一律**后置**：
MVP 的商品图由用户手动上传 + 手动定版（``POST /files`` → 落 ``product_images`` 行）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.types import AssetQualityLevel, AssetViewAngle, ProjectStyle, ProjectVisualStyle

if TYPE_CHECKING:
    from app.models.studio_projects import Project
    from app.models.studio_prompts_files_timeline import PromptTemplate
    from app.models.studio_shots import Shot


class Product(Base, TimestampMixin):
    """商品表。

    字段与 ``Prop`` **逐列对齐**（同样的 9 列 + 时间戳），理由：
    商品在"可复用资产"这件事上与道具同构（名称 / 描述 / 题材风格 / 视觉风格 /
    计划视角图数 / 标签 / 按槽位缓存的图片提示词 / 提示词模板），
    对齐后既有的资产读写、资料渲染、定版图解析都能按同一套代码路径处理。

    ``prompt_template_id`` 在 MVP 里没有写入方（不出图任务），但保留同一列，
    通道批接入时不需要再加列迁移。
    """

    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="ID")
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="商品名称")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="商品外观与卖点描述")
    style: Mapped[ProjectStyle] = mapped_column(String(32), nullable=False, comment="题材/风格")
    view_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="计划为该商品生成的视角图片数量（不含分镜帧）",
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, comment="标签")

    image_prompts: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="按图片槽位类别缓存的 LLM 生成图片提示词（{category: prompt}）",
    )
    prompt_template_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("prompt_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="提示词模板 ID（MVP 无写入方，通道批接入用）",
    )
    visual_style: Mapped[ProjectVisualStyle] = mapped_column(
        String(16),
        nullable=False,
        default=ProjectVisualStyle.live_action,
        comment="画面表现形式（现实/动漫等）",
    )

    prompt_template: Mapped["PromptTemplate | None"] = relationship()
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProductImage.id",
    )
    links: Mapped[list["ProjectProductLink"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProjectProductLink.id",
    )

    __table_args__ = (
        Index("ix_products_name", "name"),
        UniqueConstraint("name", name="uq_products_name"),
    )


class ProductImage(Base, TimestampMixin):
    """商品多角度图片。

    应用层保证（与其余四个 ``*Image`` 表同口径）：
    - 同一 ``product_id`` 下至多一条 ``is_primary=True``；库表**无**该唯一约束；
    - ``(product_id, quality_level, view_angle)`` 唯一由约束保证。

    MVP 用途：用户手动上传 + 手动定版；定版图经 ``reference_resolver`` 进入
    帧参考（``reference_file_ids`` / ``reference_labels``），**不进文本提示词**。
    """

    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="图片行 ID")
    product_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属商品 ID",
    )
    file_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("files.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="关联的文件 ID（FileItem，可空，支持先创建槽位后填充）",
    )
    quality_level: Mapped[AssetQualityLevel] = mapped_column(
        String(16),
        nullable=False,
        default=AssetQualityLevel.low,
        index=True,
    )
    view_angle: Mapped[AssetViewAngle] = mapped_column(
        String(32),
        nullable=False,
        default=AssetViewAngle.front,
        index=True,
    )
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    format: Mapped[str] = mapped_column(String(32), nullable=False, default="png")

    is_primary: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="是否定版主图；应用层需保证同一商品下至多一张",
    )

    product: Mapped["Product"] = relationship(back_populates="images")

    __table_args__ = (
        UniqueConstraint(
            "product_id",
            "quality_level",
            "view_angle",
            name="uq_product_images_quality_angle",
        ),
    )


class ProjectProductLink(Base, TimestampMixin):
    """项目/章节/镜头 -> 商品关联（三档作用域，形状与 ``ProjectPropLink`` 一致）。

    这张表同时承担「这一镜里出现了商品」这件事的**唯一表达**：
    ``shot_id`` 非空的行数即"出现商品的镜头数"，
    「商品至少出现在一半镜头」因此可以**由行数校验**，而不依赖模型自述，
    也不需要给 ``shots`` / ``shot_details`` 加布尔列（加列会与关联行互相矛盾）。
    """

    __tablename__ = "project_product_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="关联行 ID")
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="项目 ID",
    )
    chapter_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("chapters.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="章节 ID（空 = 项目档）",
    )
    shot_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("shots.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="镜头 ID（非空 = 该镜出现了这个商品）",
    )
    product_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="商品 ID",
    )

    project: Mapped["Project"] = relationship()
    shot: Mapped["Shot"] = relationship()
    product: Mapped["Product"] = relationship(back_populates="links")

    __table_args__ = (
        UniqueConstraint(
            "product_id",
            "project_id",
            "chapter_id",
            "shot_id",
            name="uq_project_product_links_product_scope",
        ),
    )


__all__ = ["Product", "ProductImage", "ProjectProductLink"]
