from __future__ import annotations

from sqlalchemy import case, func, literal, JSON, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.types import ProjectStyle, ProjectVisualStyle


class StructuredAssetMixin:
    """从分类设定派生描述，保证摘要、搜索和生成读取相同的资产事实。"""

    supplementary_info: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="补充信息")

    @hybrid_property
    def description(self) -> str:
        """按固定顺序整理已确认字段，不补全未知信息或截断用户要求。"""
        parts = []
        for field, label in self.description_fields:
            value = (getattr(self, field, None) or "").strip()
            if value and value != "不适用":
                parts.append(f"{label}：{value}")
        supplement = (self.supplementary_info or "").strip()
        if supplement:
            parts.append(supplement)
        return "\n".join(parts)

    @description.expression
    def description(cls):
        """提供可用于数据库搜索的同源描述表达式，避免维护另一份文本列。"""
        result = literal("")
        for field, label in cls.description_fields:
            value = func.trim(func.coalesce(getattr(cls, field), ""))
            result = result + case((value.not_in(["", "不适用"]), literal(label + "：") + value + "\n"), else_="")
        return func.trim(result + func.coalesce(cls.supplementary_info, ""))


class Scene(StructuredAssetMixin, Base, TimestampMixin):
    """场景表。"""

    __tablename__ = "scenes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="ID")
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="名称")
    description_fields = (('scene_type', '场所类型'), ('spatial_layout', '空间布局'), ('environment_features', '环境特征'), ('materials', '主要材质'), ('color_palette', '色彩'))
    scene_type: Mapped[str | None] = mapped_column(Text, nullable=True, comment="场所类型")
    spatial_layout: Mapped[str | None] = mapped_column(Text, nullable=True, comment="空间布局")
    environment_features: Mapped[str | None] = mapped_column(Text, nullable=True, comment="环境特征")
    materials: Mapped[str | None] = mapped_column(Text, nullable=True, comment="主要材质")
    color_palette: Mapped[str | None] = mapped_column(Text, nullable=True, comment="色彩")
    style: Mapped[ProjectStyle] = mapped_column(String(32), nullable=False, comment="题材/风格")
    view_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="计划为该场景生成的视角图片数量（不含分镜帧）",
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, comment="标签")
    prompt_template_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("prompt_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="提示词模板 ID",
    )
    visual_style: Mapped[ProjectVisualStyle] = mapped_column(
        String(16),
        nullable=False,
        default=ProjectVisualStyle.live_action,
        comment="画面表现形式（现实/动漫等）",
    )

    prompt_template: Mapped["PromptTemplate | None"] = relationship()
    images: Mapped[list["SceneImage"]] = relationship(
        back_populates="scene",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="SceneImage.id",
    )

    __table_args__ = (
        Index("ix_scenes_name", "name"),
        UniqueConstraint("name", name="uq_scenes_name"),
    )


class Prop(StructuredAssetMixin, Base, TimestampMixin):
    """道具表。角色道具绑定见 CharacterPropLink。"""

    __tablename__ = "props"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="ID")
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="名称")
    description_fields = (('prop_type', '道具类型'), ('shape', '外形结构'), ('size_description', '尺寸或相对尺度'), ('materials', '材质'), ('colors', '颜色'))
    prop_type: Mapped[str | None] = mapped_column(Text, nullable=True, comment="道具类型")
    shape: Mapped[str | None] = mapped_column(Text, nullable=True, comment="外形结构")
    size_description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="尺寸或相对尺度")
    materials: Mapped[str | None] = mapped_column(Text, nullable=True, comment="材质")
    colors: Mapped[str | None] = mapped_column(Text, nullable=True, comment="颜色")
    style: Mapped[ProjectStyle] = mapped_column(String(32), nullable=False, comment="题材/风格")
    view_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="计划为该道具生成的视角图片数量（不含分镜帧）",
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, comment="标签")
    prompt_template_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("prompt_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="提示词模板 ID",
    )
    visual_style: Mapped[ProjectVisualStyle] = mapped_column(
        String(16),
        nullable=False,
        default=ProjectVisualStyle.live_action,
        comment="画面表现形式（现实/动漫等）",
    )

    prompt_template: Mapped["PromptTemplate | None"] = relationship()
    images: Mapped[list["PropImage"]] = relationship(
        back_populates="prop",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PropImage.id",
    )
    character_prop_links: Mapped[list["CharacterPropLink"]] = relationship(
        back_populates="prop",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_props_name", "name"),
        UniqueConstraint("name", name="uq_props_name"),
    )


class Costume(StructuredAssetMixin, Base, TimestampMixin):
    """服装表。角色服装见 Character.costume_id。"""

    __tablename__ = "costumes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="ID")
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="名称")
    description_fields = (('costume_type', '服装类型'), ('structure', '款式层次'), ('materials', '材质'), ('colors', '颜色'), ('patterns_accessories', '纹样与附属配饰'))
    costume_type: Mapped[str | None] = mapped_column(Text, nullable=True, comment="服装类型")
    structure: Mapped[str | None] = mapped_column(Text, nullable=True, comment="款式层次")
    materials: Mapped[str | None] = mapped_column(Text, nullable=True, comment="材质")
    colors: Mapped[str | None] = mapped_column(Text, nullable=True, comment="颜色")
    patterns_accessories: Mapped[str | None] = mapped_column(Text, nullable=True, comment="纹样与附属配饰")
    style: Mapped[ProjectStyle] = mapped_column(String(32), nullable=False, comment="题材/风格")
    view_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="计划为该服装生成的视角图片数量（不含分镜帧）",
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, comment="标签")
    prompt_template_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("prompt_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="提示词模板 ID",
    )
    visual_style: Mapped[ProjectVisualStyle] = mapped_column(
        String(16),
        nullable=False,
        default=ProjectVisualStyle.live_action,
        comment="画面表现形式（现实/动漫等）",
    )

    prompt_template: Mapped["PromptTemplate | None"] = relationship()
    images: Mapped[list["CostumeImage"]] = relationship(
        back_populates="costume",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CostumeImage.id",
    )
    characters: Mapped[list["Character"]] = relationship(back_populates="costume")

    __table_args__ = (
        Index("ix_costumes_name", "name"),
        UniqueConstraint("name", name="uq_costumes_name"),
    )


class Actor(StructuredAssetMixin, Base, TimestampMixin):
    """演员表（与角色区分）。

    说明：
    - 使用 ActorImage（旧） 的字段集合，作为“演员形象/立绘资产”的主表。
    - 归属由 ProjectActorLink（project/chapter/shot 维度）表达。
    """

    __tablename__ = "actors"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="ID")
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="名称")
    description_fields = (('age_appearance', '外观年龄'), ('gender', '性别设定'), ('build', '体型'), ('facial_features', '五官特征'), ('skin_tone', '肤色'), ('hair', '发型发色'))
    age_appearance: Mapped[str | None] = mapped_column(Text, nullable=True, comment="外观年龄")
    gender: Mapped[str | None] = mapped_column(Text, nullable=True, comment="性别设定")
    build: Mapped[str | None] = mapped_column(Text, nullable=True, comment="体型")
    facial_features: Mapped[str | None] = mapped_column(Text, nullable=True, comment="五官特征")
    skin_tone: Mapped[str | None] = mapped_column(Text, nullable=True, comment="肤色")
    hair: Mapped[str | None] = mapped_column(Text, nullable=True, comment="发型发色")
    style: Mapped[ProjectStyle] = mapped_column(String(32), nullable=False, comment="题材/风格")
    view_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="计划为该演员形象生成的视角图片数量（不含分镜帧）",
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, comment="标签")
    prompt_template_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("prompt_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="提示词模板 ID",
    )
    visual_style: Mapped[ProjectVisualStyle] = mapped_column(
        String(16),
        nullable=False,
        default=ProjectVisualStyle.live_action,
        comment="画面表现形式（现实/动漫等）",
    )

    prompt_template: Mapped["PromptTemplate | None"] = relationship()
    images: Mapped[list["ActorImage"]] = relationship(
        back_populates="actor",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ActorImage.id",
    )
    characters: Mapped[list["Character"]] = relationship(back_populates="actor")

    __table_args__ = (
        Index("ix_actors_name", "name"),
        UniqueConstraint("name", name="uq_actors_name"),
    )


class Character(Base, TimestampMixin):
    """角色表（归属项目）。

    组成约定：
    - 角色由：Actor（演员） + Costume（服装） + Props（道具）组成。
    - 场次设计通过版本化资产需求引用角色。

    应用层保证：
    - `costume_id` 所指服装应为该角色所属项目或全局资产，避免跨项目误用。
    """

    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="角色 ID")
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属项目 ID",
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="角色名称")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="角色描述")
    style: Mapped[ProjectStyle] = mapped_column(String(32), nullable=False, comment="题材/风格")
    visual_style: Mapped[ProjectVisualStyle] = mapped_column(
        String(16),
        nullable=False,
        default=ProjectVisualStyle.live_action,
        comment="画面表现形式（现实/动漫等）",
    )
    actor_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("actors.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
        comment="对应演员 ID",
    )
    costume_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("costumes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="服装 ID（可空）；应用层需保证与角色同项目或全局",
    )

    project: Mapped["Project"] = relationship(back_populates="characters")
    actor: Mapped["Actor"] = relationship(back_populates="characters")
    costume: Mapped["Costume | None"] = relationship(back_populates="characters")
    prop_links: Mapped[list["CharacterPropLink"]] = relationship(
        back_populates="character",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CharacterPropLink.index",
    )
    images: Mapped[list["CharacterImage"]] = relationship(
        back_populates="character",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CharacterImage.id",
    )

    __table_args__ = (
        Index("ix_characters_name", "name"),
        UniqueConstraint("project_id", "name", name="uq_characters_project_name"),
    )


class CharacterPropLink(Base,TimestampMixin):
    """角色与道具绑定（多对多）。

    应用层保证：
    - `prop_id` 所指道具应为该角色所属项目或全局资产，避免跨项目误用。
    """

    __tablename__ = "character_prop_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="关联行 ID")
    character_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("characters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="角色 ID",
    )
    prop_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("props.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="道具 ID",
    )
    index: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="角色道具排序")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="备注（可选）")

    character: Mapped["Character"] = relationship(back_populates="prop_links")
    prop: Mapped["Prop"] = relationship(back_populates="character_prop_links")

    __table_args__ = (
        UniqueConstraint("character_id", "prop_id", name="uq_character_prop_links_character_prop"),
        UniqueConstraint("character_id", "index", name="uq_character_prop_links_character_index"),
    )


__all__ = [
    "Scene",
    "Prop",
    "Costume",
    "Actor",
    "Character",
    "CharacterPropLink",
]
