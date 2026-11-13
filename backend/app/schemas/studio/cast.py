"""演员/角色及关联表 schemas。"""

from __future__ import annotations

from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.studio.asset_fields import ActorFields

from app.core.contracts.asset_prompts import AssetPromptReference

from app.models.studio import ProjectStyle, ProjectVisualStyle


class ActorBase(BaseModel):
    id: str = Field(..., description="演员 ID")
    name: str = Field(..., description="名称")
    tags: list[str] = Field(default_factory=list, description="标签")
    prompt_template_id: str | None = Field(None, description="提示词模板 ID（可空）")
    view_count: int = Field(1, ge=1, description="计划为该演员生成的视角图片数量（不含分镜帧）")
    style: ProjectStyle = Field(ProjectStyle.real_people_city, description="题材/风格")
    visual_style: ProjectVisualStyle = Field(ProjectVisualStyle.live_action, description="画面表现形式（真人/动漫等）")


class ActorCreate(ActorFields, ActorBase):
    """创建演员的身份设定，不接收派生描述写入。"""

    adopt_reference: AssetPromptReference | None = None

    references: list[AssetPromptReference] = Field(default_factory=list)

    project_id: str | None = Field(None, description="所属项目；不传时创建共享资产")
    chapter_id: str | None = Field(None, description="可选：章节 ID")

    @field_validator("project_id", "chapter_id", mode="before")
    @classmethod
    def _blank_link_ids(cls, v: object) -> object:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @model_validator(mode="after")
    def _link_scope(self) -> Self:
        if self.chapter_id and not self.project_id:
            raise ValueError("project_id is required when chapter_id is set")
        return self


class ActorUpdate(ActorFields):
    """局部更新演员设定，区分未传与显式清空。"""

    references: list[AssetPromptReference] = Field(default_factory=list)

    name: str | None = None
    tags: list[str] | None = None
    prompt_template_id: str | None = None
    view_count: int | None = Field(None, ge=1)
    style: ProjectStyle | None = None
    visual_style: ProjectVisualStyle | None = None


class ActorRead(ActorFields, ActorBase):
    """返回演员设定及后端派生的完整描述。"""

    references: list[AssetPromptReference] = Field(default_factory=list)

    library_copy_id: str | None = None
    source_character_id: str | None = None
    project_id: str | None = Field(None, description="所属项目；空值表示共享资产")
    description: str = Field("", description="只读完整描述")
    model_config = ConfigDict(from_attributes=True)

    thumbnail: str = Field("", description="缩略图下载地址")


class CharacterBase(BaseModel):

    references: list[AssetPromptReference] = Field(default_factory=list)
    id: str = Field(..., description="角色 ID")
    project_id: str = Field(..., description="所属项目 ID")
    name: str = Field(..., description="角色名称")
    description: str = Field("", description="角色描述")
    style: ProjectStyle = Field(ProjectStyle.real_people_city, description="题材/风格")
    visual_style: ProjectVisualStyle = Field(ProjectVisualStyle.live_action, description="画面表现形式（现实/动漫等）")


class CharacterCreate(CharacterBase):
    """创建项目角色及明确图片参考，拒绝未声明的字段。"""

    adopt_reference: AssetPromptReference | None = None

    model_config = ConfigDict(extra="forbid")

    chapter_id: str | None = Field(None, description="可选：章节 ID")

    @field_validator("project_id", "chapter_id", mode="before")
    @classmethod
    def _blank_link_ids(cls, v: object) -> object:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @model_validator(mode="after")
    def _link_scope(self) -> Self:
        if self.chapter_id and not self.project_id:
            raise ValueError("project_id is required when chapter_id is set")
        return self


class CharacterUpdate(BaseModel):
    """更新角色自身设定和明确参考，拒绝未知分类字段。"""

    references: list[AssetPromptReference] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    style: ProjectStyle | None = None
    visual_style: ProjectVisualStyle | None = None


class CharacterRead(CharacterBase):
    library_copy_id: str | None = None
    model_config = ConfigDict(from_attributes=True)

    thumbnail: str = Field("", description="缩略图下载地址")
