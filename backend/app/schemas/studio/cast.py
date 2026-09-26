"""演员/角色及关联表 schemas。"""

from __future__ import annotations

from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.studio import ProjectStyle, ProjectVisualStyle


class ActorBase(BaseModel):
    id: str = Field(..., description="演员 ID")
    name: str = Field(..., description="名称")
    description: str = Field("", description="描述")
    tags: list[str] = Field(default_factory=list, description="标签")
    prompt_template_id: str | None = Field(None, description="提示词模板 ID（可空）")
    image_prompts: dict[str, str] = Field(
        default_factory=dict, description="按图片槽位类别缓存的 LLM 生成图片提示词"
    )
    view_count: int = Field(1, ge=1, description="计划为该演员生成的视角图片数量（不含分镜帧）")
    style: ProjectStyle = Field(ProjectStyle.real_people_city, description="题材/风格")
    visual_style: ProjectVisualStyle = Field(ProjectVisualStyle.live_action, description="画面表现形式（真人/动漫等）")


class ActorCreate(ActorBase):
    project_id: str | None = Field(None, description="可选：创建成功后写入 project_actor_links（与演员创建同一事务）")
    chapter_id: str | None = Field(None, description="可选：章节 ID")
    shot_id: str | None = Field(None, description="可选：分镜 ID")

    @field_validator("project_id", "chapter_id", "shot_id", mode="before")
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
        if self.shot_id and not self.project_id:
            raise ValueError("project_id is required when shot_id is set")
        return self


class ActorUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    prompt_template_id: str | None = None
    view_count: int | None = Field(None, ge=1)
    style: ProjectStyle | None = None
    visual_style: ProjectVisualStyle | None = None
    image_prompts: dict[str, str] | None = None


class ActorRead(ActorBase):
    model_config = ConfigDict(from_attributes=True)

    thumbnail: str = Field("", description="缩略图下载地址")


class CharacterBase(BaseModel):
    id: str = Field(..., description="角色 ID")
    project_id: str = Field(..., description="所属项目 ID")
    name: str = Field(..., description="角色名称")
    description: str = Field("", description="角色描述")
    style: ProjectStyle = Field(ProjectStyle.real_people_city, description="题材/风格")
    visual_style: ProjectVisualStyle = Field(ProjectVisualStyle.live_action, description="画面表现形式（现实/动漫等）")
    image_prompts: dict[str, str] = Field(
        default_factory=dict, description="按图片槽位类别缓存的 LLM 生成图片提示词"
    )
    actor_id: str | None = Field(None, description="演员 ID（可空；用于仅导入角色文案但不关联演员时）")
    costume_id: str | None = Field(None, description="服装 ID（可空）")


class CharacterCreate(CharacterBase):
    chapter_id: str | None = Field(None, description="可选：章节 ID")
    shot_id: str | None = Field(None, description="可选：创建成功后自动绑定的分镜 ID")

    @field_validator("project_id", "chapter_id", "shot_id", mode="before")
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
        if self.shot_id and not self.project_id:
            raise ValueError("project_id is required when shot_id is set")
        return self


class CharacterUpdate(BaseModel):
    project_id: str | None = None
    name: str | None = None
    description: str | None = None
    style: ProjectStyle | None = None
    visual_style: ProjectVisualStyle | None = None
    image_prompts: dict[str, str] | None = None
    actor_id: str | None = None
    costume_id: str | None = None


class CharacterRead(CharacterBase):
    model_config = ConfigDict(from_attributes=True)

    thumbnail: str = Field("", description="缩略图下载地址")


class CharacterPropLinkBase(BaseModel):
    id: int = Field(..., description="关联行 ID")
    character_id: str = Field(..., description="角色 ID")
    prop_id: str = Field(..., description="道具 ID")
    index: int = Field(0, description="角色道具排序")
    note: str = Field("", description="备注")


class CharacterPropLinkCreate(BaseModel):
    character_id: str
    prop_id: str
    index: int = 0
    note: str = ""


class CharacterPropLinkUpdate(BaseModel):
    index: int | None = None
    note: str | None = None


class CharacterPropLinkRead(CharacterPropLinkBase):
    model_config = ConfigDict(from_attributes=True)


class ShotCharacterLinkBase(BaseModel):
    id: int = Field(..., description="关联行 ID")
    shot_id: str = Field(..., description="镜头 ID")
    character_id: str = Field(..., description="角色 ID")
    index: int = Field(0, description="镜头内角色排序")
    note: str = Field("", description="备注")


class ShotCharacterLinkCreate(BaseModel):
    shot_id: str
    character_id: str
    index: int = 0
    note: str = ""


class ShotCharacterLinkUpdate(BaseModel):
    index: int | None = None
    note: str | None = None


class ShotCharacterLinkRead(ShotCharacterLinkBase):
    model_config = ConfigDict(from_attributes=True)
