"""Project/Chapter 的请求响应模型。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.studio import ChapterStatus, ProjectStartMode, ProjectStyle, ProjectVisualStyle


PROJECT_STYLE_EXAMPLES = [x.value for x in ProjectStyle]


class ProjectBase(BaseModel):
    name: str = Field(..., description="项目名称")
    description: str = Field("", description="项目简介")
    # style 允许自由文本（自定义风格），预设枚举值仍作为候选项下发。
    # 长度上限 32 与 projects.style 列的 String(32) 对齐，避免写入后读回不一致。
    style: str = Field(
        ...,
        max_length=32,
        description="题材/风格（可用预设值，也可自定义）",
        examples=PROJECT_STYLE_EXAMPLES,
    )
    visual_style: ProjectVisualStyle = Field(ProjectVisualStyle.live_action, description="画面表现形式")
    seed: int = Field(0, description="随机种子")
    unify_style: bool = Field(True, description="是否统一风格")
    progress: int = Field(0, description="进度百分比（0-100）")
    default_video_ratio: str | None = Field(None, description="项目级默认视频比例；分镜未覆盖时生效")
    start_mode: ProjectStartMode = Field(
        ProjectStartMode.script,
        description="项目起点：script=从剧本开始；prompts=从视频提示词开始",
    )

    @field_validator("start_mode", mode="before")
    @classmethod
    def _default_start_mode(cls, value: object) -> object:
        """`None` 按 `script` 处理。

        覆盖两种情况：① 迁移前写入、尚未回填的历史行；② 内存中刚构造还没 flush 的
        ORM 对象（列默认值此时还没生效）。两者都不该让响应校验 500。
        """
        return ProjectStartMode.script if value is None else value
    stats: dict[str, Any] = Field(default_factory=dict, description="聚合统计（JSON）")


class ProjectCreate(ProjectBase):
    id: str = Field(..., description="项目 ID")


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    style: str | None = Field(None, max_length=32, description="题材/风格（可用预设值，也可自定义）", examples=PROJECT_STYLE_EXAMPLES)
    visual_style: ProjectVisualStyle | None = None
    seed: int | None = None
    unify_style: bool | None = None
    progress: int | None = None
    default_video_ratio: str | None = None
    start_mode: ProjectStartMode | None = None
    stats: dict[str, Any] | None = None


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    # 时间戳下发给前端：项目列表按真实创建时间排序并在卡片上显示，
    # 而不是像以前那样用前端 `stats.updated_at`（后端从不写入）回退成「当前时间」。
    created_at: datetime | None = Field(None, description="创建时间")
    updated_at: datetime | None = Field(None, description="最后更新时间")


class ChapterBase(BaseModel):
    project_id: str = Field(..., description="所属项目 ID")
    index: int = Field(..., description="章节序号（项目内唯一）")
    title: str = Field(..., description="章节标题")
    summary: str = Field("", description="章节摘要")
    raw_text: str = Field("", description="章节原文")
    condensed_text: str = Field("", description="精简原文")
    storyboard_count: int = Field(0, description="分镜数量")
    status: ChapterStatus = Field(ChapterStatus.draft, description="章节状态")


class ChapterCreate(ChapterBase):
    id: str = Field(..., description="章节 ID")


class ChapterUpdate(BaseModel):
    project_id: str | None = None
    index: int | None = None
    title: str | None = None
    summary: str | None = None
    raw_text: str | None = None
    condensed_text: str | None = None
    storyboard_count: int | None = None
    status: ChapterStatus | None = None


class ChapterRead(ChapterBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    shot_count: int = Field(0, description="分镜数（shots 条数聚合）")


class StyleOption(BaseModel):
    """通用下拉选项。"""

    value: str = Field(..., description="选项值")
    label: str = Field(..., description="选项展示文案")


class ProjectStyleOptionsRead(BaseModel):
    """项目风格候选项。"""

    visual_styles: list[StyleOption] = Field(default_factory=list, description="视觉风格可选项")
    styles_by_visual_style: dict[str, list[StyleOption]] = Field(
        default_factory=dict,
        description="按视觉风格分组的视频风格选项",
    )
    default_style_by_visual_style: dict[str, str] = Field(
        default_factory=dict,
        description="各视觉风格默认视频风格",
    )
