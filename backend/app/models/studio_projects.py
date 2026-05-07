from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.types import ChapterStatus, ProjectStyle, ProjectVisualStyle

if TYPE_CHECKING:
    from app.models.studio_assets import Actor, Character, Costume, Prop, Scene
    from app.models.studio_shots import Shot
    from app.models.studio_timeline_chapter import ChapterTimelineSegment, ChapterTimelineState


class Project(Base, TimestampMixin):
    """项目表。

    说明：
    - `stats` 使用 JSON 存储聚合统计，便于快速渲染与渐进扩展；如需要强一致统计可后续改为物化/触发器维护。
    """

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="项目 ID")
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="项目名称")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="项目简介")
    style: Mapped[ProjectStyle] = mapped_column(String(32), nullable=False, comment="题材/风格")
    visual_style: Mapped[ProjectVisualStyle] = mapped_column(
        String(16),
        nullable=False,
        default=ProjectVisualStyle.live_action,
        comment="画面表现形式（真人/动漫等）",
    )
    seed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="随机种子")
    unify_style: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否统一风格（跨章节）")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="进度百分比（0-100）")
    default_video_ratio: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
        default=None,
        comment="项目级默认视频比例（可为空；分镜未覆盖时使用）",
    )
    stats: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict, comment="聚合统计（JSON）")

    chapters: Mapped[list["Chapter"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    characters: Mapped[list["Character"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Character.id",
    )
    actor_links: Mapped[list["ProjectActorLink"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProjectActorLink.id",
    )
    scene_links: Mapped[list["ProjectSceneLink"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProjectSceneLink.id",
    )
    prop_links: Mapped[list["ProjectPropLink"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProjectPropLink.id",
    )
    costume_links: Mapped[list["ProjectCostumeLink"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProjectCostumeLink.id",
    )

    __table_args__ = (
        Index("ix_projects_updated_at", "updated_at"),
        Index("ix_projects_style", "style"),
        Index("ix_projects_visual_style", "visual_style"),
    )


class Chapter(Base, TimestampMixin):
    """章节表。

    约束：
    - `project_id + index` 唯一，保证一个项目内集数序号不重复。
    """

    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="章节 ID")
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属项目 ID",
    )
    index: Mapped[int] = mapped_column(Integer, nullable=False, comment="章节序号（项目内唯一）")
    title: Mapped[str] = mapped_column(String(255), nullable=False, comment="章节标题")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="章节摘要")
    raw_text: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="章节原文（未清洗/可较长）")
    condensed_text: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="由模型精简后的原文（用于抽取/提示词）")
    storyboard_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="分镜数量")
    status: Mapped[ChapterStatus] = mapped_column(
        String(32),
        nullable=False,
        default=ChapterStatus.draft,
        comment="章节状态",
    )

    project: Mapped["Project"] = relationship(back_populates="chapters")
    shots: Mapped[list["Shot"]] = relationship(
        back_populates="chapter",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    timeline_state: Mapped["ChapterTimelineState | None"] = relationship(
        "ChapterTimelineState",
        back_populates="chapter",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    timeline_segments: Mapped[list["ChapterTimelineSegment"]] = relationship(
        "ChapterTimelineSegment",
        back_populates="chapter",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ChapterTimelineSegment.position",
    )

    __table_args__ = (
        UniqueConstraint("project_id", "index", name="uq_chapters_project_index"),
        Index("ix_chapters_updated_at", "updated_at"),
        Index("ix_chapters_status", "status"),
        Index("ix_chapters_project_title", "project_id", "title"),
    )


class ProjectActorLink(Base, TimestampMixin):
    """项目/章节/镜头 -> 演员关联。"""

    __tablename__ = "project_actor_links"

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
        comment="章节 ID",
    )
    shot_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("shots.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="镜头 ID",
    )
    actor_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("actors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="演员 ID",
    )

    project: Mapped["Project"] = relationship(back_populates="actor_links")
    shot: Mapped["Shot"] = relationship(back_populates="actor_links")
    actor: Mapped["Actor"] = relationship()

    __table_args__ = (
        UniqueConstraint("actor_id", "project_id", "chapter_id", "shot_id", name="uq_project_actor_links_actor_scope"),
    )


class ProjectSceneLink(Base, TimestampMixin):
    """项目/章节/镜头 -> 场景关联。"""

    __tablename__ = "project_scene_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="关联行 ID")
    project_id: Mapped[str] = mapped_column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True, comment="项目 ID")
    chapter_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True, index=True, comment="章节 ID")
    shot_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("shots.id", ondelete="SET NULL"), nullable=True, index=True, comment="镜头 ID")
    scene_id: Mapped[str] = mapped_column(String(64), ForeignKey("scenes.id", ondelete="CASCADE"), nullable=False, index=True, comment="场景 ID")

    project: Mapped["Project"] = relationship(back_populates="scene_links")
    shot: Mapped["Shot"] = relationship(back_populates="scene_links")
    scene: Mapped["Scene"] = relationship()

    __table_args__ = (
        UniqueConstraint("scene_id", "project_id", "chapter_id", "shot_id", name="uq_project_scene_links_scene_scope"),
    )


class ProjectPropLink(Base, TimestampMixin):
    """项目/章节/镜头 -> 道具关联。"""

    __tablename__ = "project_prop_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="关联行 ID")
    project_id: Mapped[str] = mapped_column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True, comment="项目 ID")
    chapter_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True, index=True, comment="章节 ID")
    shot_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("shots.id", ondelete="SET NULL"), nullable=True, index=True, comment="镜头 ID")
    prop_id: Mapped[str] = mapped_column(String(64), ForeignKey("props.id", ondelete="CASCADE"), nullable=False, index=True, comment="道具 ID")

    project: Mapped["Project"] = relationship(back_populates="prop_links")
    shot: Mapped["Shot"] = relationship(back_populates="prop_links")
    prop: Mapped["Prop"] = relationship()

    __table_args__ = (
        UniqueConstraint("prop_id", "project_id", "chapter_id", "shot_id", name="uq_project_prop_links_prop_scope"),
    )


class ProjectCostumeLink(Base, TimestampMixin):
    """项目/章节/镜头 -> 服装关联。"""

    __tablename__ = "project_costume_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="关联行 ID")
    project_id: Mapped[str] = mapped_column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True, comment="项目 ID")
    chapter_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True, index=True, comment="章节 ID")
    shot_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("shots.id", ondelete="SET NULL"), nullable=True, index=True, comment="镜头 ID")
    costume_id: Mapped[str] = mapped_column(String(64), ForeignKey("costumes.id", ondelete="CASCADE"), nullable=False, index=True, comment="服装 ID")

    project: Mapped["Project"] = relationship(back_populates="costume_links")
    shot: Mapped["Shot"] = relationship(back_populates="costume_links")
    costume: Mapped["Costume"] = relationship()

    __table_args__ = (
        UniqueConstraint("costume_id", "project_id", "chapter_id", "shot_id", name="uq_project_costume_links_costume_scope"),
    )


__all__ = [
    "Project",
    "Chapter",
    "ProjectActorLink",
    "ProjectSceneLink",
    "ProjectPropLink",
    "ProjectCostumeLink",
]
