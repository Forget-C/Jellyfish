from __future__ import annotations

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.types import AssetQualityLevel, AssetViewAngle


class CharacterImage(Base, TimestampMixin):
    """角色图片（多角度/多精度）。归属角色；同一角色下至多一张 is_primary=True。

    应用层保证：
    - 同一 character_id 下至多一条 is_primary=True。
    """

    __tablename__ = "character_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="图片行 ID")
    character_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("characters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属角色 ID",
    )
    file_id: Mapped[str] = mapped_column(
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
        comment="精度等级",
    )
    view_angle: Mapped[AssetViewAngle] = mapped_column(
        String(32),
        nullable=False,
        default=AssetViewAngle.front,
        index=True,
        comment="视角",
    )
    width: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="宽（px）")
    height: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="高（px）")
    format: Mapped[str] = mapped_column(String(32), nullable=True, default="png", comment="格式")
    is_primary: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="是否主图；应用层需保证同一角色下至多一张主图",
    )

    character: Mapped["Character"] = relationship(back_populates="images")

    __table_args__ = (
        UniqueConstraint(
            "character_id",
            "quality_level",
            "view_angle",
            name="uq_character_images_quality_angle",
        ),
    )


class ActorImage(Base, TimestampMixin):
    """演员形象/立绘多角度图片。

    应用层保证：
    - 同一 `actor_id` 下至多一条 `is_primary=True`；库表无唯一约束，需在写入/更新时保证。
    """

    __tablename__ = "actor_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="图片行 ID")
    actor_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("actors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属演员 ID",
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
        comment="精度等级",
    )
    view_angle: Mapped[AssetViewAngle] = mapped_column(
        String(32),
        nullable=False,
        default=AssetViewAngle.front,
        index=True,
        comment="视角",
    )
    width: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="宽（px）")
    height: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="高（px）")
    format: Mapped[str] = mapped_column(String(32), nullable=False, default="png", comment="格式")
    prompt_overrides: Mapped[dict[str, str]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="此图片的展示提示词变量覆盖；不影响同一演员的其他视角",
    )

    actor: Mapped["Actor"] = relationship(back_populates="images")

    __table_args__ = (
        UniqueConstraint("actor_id", "quality_level", "view_angle", name="uq_actor_images_quality_angle"),
    )


class SceneImage(Base, TimestampMixin):
    """场景多角度图片。

    应用层保证：
    - 同一 `scene_id` 下至多一条 `is_primary=True`；库表无唯一约束，需在写入/更新时保证。
    """

    __tablename__ = "scene_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="图片行 ID")
    scene_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("scenes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属场景 ID",
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
        comment="精度等级",
    )
    view_angle: Mapped[AssetViewAngle] = mapped_column(
        String(32),
        nullable=False,
        default=AssetViewAngle.front,
        index=True,
        comment="视角",
    )
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    format: Mapped[str] = mapped_column(String(32), nullable=False, default="png")

    scene: Mapped["Scene"] = relationship(back_populates="images")

    __table_args__ = (
        UniqueConstraint("scene_id", "quality_level", "view_angle", name="uq_scene_images_quality_angle"),
    )


class PropImage(Base, TimestampMixin):
    """道具多角度图片。

    应用层保证：
    - 同一 `prop_id` 下至多一条 `is_primary=True`；库表无唯一约束，需在写入/更新时保证。
    """

    __tablename__ = "prop_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="图片行 ID")
    prop_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("props.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属道具 ID",
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

    prop: Mapped["Prop"] = relationship(back_populates="images")

    __table_args__ = (
        UniqueConstraint("prop_id", "quality_level", "view_angle", name="uq_prop_images_quality_angle"),
    )


class CostumeImage(Base, TimestampMixin):
    """服装多角度图片。

    应用层保证：
    - 同一 `costume_id` 下至多一条 `is_primary=True`；库表无唯一约束，需在写入/更新时保证。
    """

    __tablename__ = "costume_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="图片行 ID")
    costume_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("costumes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属服装 ID",
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

    costume: Mapped["Costume"] = relationship(back_populates="images")

    __table_args__ = (
        UniqueConstraint(
            "costume_id",
            "quality_level",
            "view_angle",
            name="uq_costume_images_quality_angle",
        ),
    )


__all__ = [
    "CharacterImage",
    "ActorImage",
    "SceneImage",
    "PropImage",
    "CostumeImage",
]
