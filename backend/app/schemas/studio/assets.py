"""资产（Scene/Prop/Costume）及其图片表的 schemas。"""

from __future__ import annotations

from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.studio import AssetQualityLevel, AssetViewAngle, ProjectStyle, ProjectVisualStyle


class AssetBase(BaseModel):
    id: str = Field(..., description="资产 ID")
    name: str = Field(..., description="名称")
    description: str = Field("", description="描述")
    tags: list[str] = Field(default_factory=list, description="标签")
    prompt_template_id: str | None = Field(None, description="提示词模板 ID（可空）")
    view_count: int = Field(1, ge=1, description="计划为该资产生成的视角图片数量（不含分镜帧）")
    style: ProjectStyle = Field(ProjectStyle.real_people_city, description="题材/风格")
    visual_style: ProjectVisualStyle = Field(ProjectVisualStyle.live_action, description="画面表现形式（现实/动漫等）")


class AssetCreate(BaseModel):
    id: str
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    prompt_template_id: str | None = None
    view_count: int = Field(1, ge=1)
    style: ProjectStyle = ProjectStyle.real_people_city
    visual_style: ProjectVisualStyle = ProjectVisualStyle.live_action
    project_id: str | None = Field(None, description="可选：创建成功后写入 project_*_link（与资产创建同一事务）")
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


class AssetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    prompt_template_id: str | None = None
    view_count: int | None = Field(None, ge=1)
    style: ProjectStyle | None = None
    visual_style: ProjectVisualStyle | None = None


class AssetRead(AssetBase):
    model_config = ConfigDict(from_attributes=True)

    thumbnail: str = Field("", description="缩略图下载地址")


class AssetImageBase(BaseModel):
    id: int = Field(..., description="图片行 ID")
    quality_level: AssetQualityLevel = Field(AssetQualityLevel.low, description="精度等级")
    view_angle: AssetViewAngle = Field(AssetViewAngle.front, description="视角")
    file_id: str | None = Field(None, description="关联的 FileItem ID（可空，支持先创建槽位后填充）")
    width: int | None = Field(None, description="宽(px)")
    height: int | None = Field(None, description="高(px)")
    format: str = Field("png", description="格式")
    prompt_overrides: dict[str, str] = Field(default_factory=dict, description="此图片的展示提示词变量覆盖")


class AssetImageCreate(BaseModel):
    quality_level: AssetQualityLevel = AssetQualityLevel.low
    view_angle: AssetViewAngle = AssetViewAngle.front
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str = "png"
    prompt_overrides: dict[str, str] = Field(default_factory=dict)


class AssetImageUpdate(BaseModel):
    quality_level: AssetQualityLevel | None = None
    view_angle: AssetViewAngle | None = None
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str | None = None
    prompt_overrides: dict[str, str] | None = None


class SceneRead(AssetRead):
    pass


class PropRead(AssetRead):
    pass


class CostumeRead(AssetRead):
    pass


class SceneImageRead(AssetImageBase):
    model_config = ConfigDict(from_attributes=True)

    scene_id: str


class PropImageRead(AssetImageBase):
    model_config = ConfigDict(from_attributes=True)

    prop_id: str


class CostumeImageRead(AssetImageBase):
    model_config = ConfigDict(from_attributes=True)

    costume_id: str


class CharacterImageRead(AssetImageBase):
    model_config = ConfigDict(from_attributes=True)

    character_id: str
