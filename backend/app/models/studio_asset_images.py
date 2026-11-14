from __future__ import annotations

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.types import AssetQualityLevel, AssetViewAngle


class ImagePrimaryMixin:
    """对象图片的显式主图标记；写入时由服务串行维护唯一主图。"""

    is_view_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class CharacterImage(ImagePrimaryMixin, Base, TimestampMixin):
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
    prompt_overrides: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict, comment="此图片的展示提示词变量覆盖")
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="槽位 CAS 版本")

    character: Mapped["Character"] = relationship(back_populates="images")



class ActorImage(ImagePrimaryMixin, Base, TimestampMixin):
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
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="槽位 CAS 版本")

    actor: Mapped["Actor"] = relationship(back_populates="images")



class SceneImage(ImagePrimaryMixin, Base, TimestampMixin):
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
    prompt_overrides: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict, comment="此图片的展示提示词变量覆盖")
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="槽位 CAS 版本")

    scene: Mapped["Scene"] = relationship(back_populates="images")



class PropImage(ImagePrimaryMixin, Base, TimestampMixin):
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
    prompt_overrides: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict, comment="此图片的展示提示词变量覆盖")
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="槽位 CAS 版本")

    prop: Mapped["Prop"] = relationship(back_populates="images")



class CostumeImage(ImagePrimaryMixin, Base, TimestampMixin):
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
    prompt_overrides: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict, comment="此图片的展示提示词变量覆盖")
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="槽位 CAS 版本")

    costume: Mapped["Costume"] = relationship(back_populates="images")



__all__ = [
    "CharacterImage",
    "ActorImage",
    "SceneImage",
    "PropImage",
    "CostumeImage",
]
