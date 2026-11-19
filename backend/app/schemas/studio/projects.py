"""Project/Chapter 的请求响应模型。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.schemas.source_explanations import chapter_basis_version
from app.schemas.source_explanations import SourceExplanation

from app.models.studio import ChapterStatus, ProjectStyle, ProjectVisualStyle


PROJECT_STYLE_EXAMPLES = [x.value for x in ProjectStyle]


class ProjectBase(BaseModel):
    name: str = Field(..., description="项目名称")
    description: str = Field("", description="项目简介")
    style: ProjectStyle = Field(..., description="题材/风格", examples=PROJECT_STYLE_EXAMPLES)
    visual_style: ProjectVisualStyle = Field(ProjectVisualStyle.live_action, description="画面表现形式")
    seed: int = Field(0, description="随机种子")
    unify_style: bool = Field(True, description="是否统一风格")
    progress: int = Field(0, description="进度百分比（0-100）")
    default_video_ratio: str | None = Field(None, description="项目级默认视频比例；分镜未覆盖时生效")
    stats: dict[str, Any] = Field(default_factory=dict, description="聚合统计（JSON）")


class ProjectCreate(ProjectBase):
    id: str = Field(..., description="项目 ID")


class ProjectUpdate(BaseModel):
    cover_file_id: str | None = Field(None, min_length=1, max_length=64,
        description="源图片 ID，保存时克隆；显式 null 恢复默认，省略保留当前封面")
    name: str | None = None
    description: str | None = None
    style: ProjectStyle | None = Field(None, description="题材/风格", examples=PROJECT_STYLE_EXAMPLES)
    visual_style: ProjectVisualStyle | None = None
    seed: int | None = None
    unify_style: bool | None = None
    progress: int | None = None
    default_video_ratio: str | None = None
    stats: dict[str, Any] | None = None


class ProjectRead(ProjectBase):
    cover_file_id: str | None = Field(None, description="已保存的项目封面副本 ID")
    model_config = ConfigDict(from_attributes=True)

    id: str


class ChapterBase(BaseModel):
    project_id: str = Field(..., description="所属项目 ID")
    index: int = Field(..., description="章节序号（项目内唯一）")
    title: str = Field(..., description="章节标题")
    summary: str = Field("", description="章节摘要")
    raw_text: str = Field("", description="章节原文")
    source_explanations: list[SourceExplanation] | None = None
    condensed_text: str = Field("", description="精简原文")
    status: ChapterStatus = Field(ChapterStatus.draft, description="章节状态")


class ChapterCreate(ChapterBase):
    id: str = Field(..., description="章节 ID")


class ChapterUpdate(BaseModel):
    expected_basis_version: str | None = None
    project_id: str | None = None
    index: int | None = None
    title: str | None = None
    summary: str | None = None
    raw_text: str | None = None
    source_explanations: list[SourceExplanation] | None = None
    condensed_text: str | None = None
    status: ChapterStatus | None = None


class ChapterRead(ChapterBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    @computed_field
    @property
    def basis_version(self) -> str:
        """当前原文与全部解释的编辑基线。"""
        return chapter_basis_version(self.raw_text, [item.model_dump() for item in self.source_explanations or []])

    sequence_count: int = Field(0, description="已确认场次数")


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
