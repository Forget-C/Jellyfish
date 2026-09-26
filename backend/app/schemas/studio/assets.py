"""资产（Scene/Prop/Costume）及其图片表的 schemas。"""

from __future__ import annotations

from typing import Literal, Self

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
    image_prompts: dict[str, str] = Field(
        default_factory=dict, description="按图片槽位类别缓存的 LLM 生成图片提示词"
    )


class AssetCreate(BaseModel):
    id: str
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    prompt_template_id: str | None = None
    view_count: int = Field(1, ge=1)
    style: ProjectStyle = ProjectStyle.real_people_city
    visual_style: ProjectVisualStyle = ProjectVisualStyle.live_action
    image_prompts: dict[str, str] = Field(default_factory=dict)
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
    image_prompts: dict[str, str] | None = None


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
    is_primary: bool = Field(False, description="是否定版主图")


class AssetImageCreate(BaseModel):
    quality_level: AssetQualityLevel = AssetQualityLevel.low
    view_angle: AssetViewAngle = AssetViewAngle.front
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str = "png"
    is_primary: bool | None = None


class AssetImageUpdate(BaseModel):
    quality_level: AssetQualityLevel | None = None
    view_angle: AssetViewAngle | None = None
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str | None = None
    is_primary: bool | None = None


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


class ProductImageRead(AssetImageBase):
    model_config = ConfigDict(from_attributes=True)

    product_id: str


class CharacterImageRead(AssetImageBase):
    model_config = ConfigDict(from_attributes=True)

    character_id: str


class ProjectAssetReadinessItem(BaseModel):
    """项目内一项资产的准备状态（四类资产同一口径，见 `project_asset_readiness`）。"""

    asset_type: Literal["character", "scene", "prop", "costume", "product"] = Field(
        ..., description="资产类型"
    )
    asset_id: str = Field(..., description="资产 ID")
    name: str = Field("", description="资产名称")
    has_pending_candidate: bool = Field(
        False, description="本项目内是否还有同类型同名的未确认提取候选"
    )
    has_image_prompt: bool = Field(False, description="是否已保存图片提示词（image_prompts 有非空槽位）")
    has_image: bool = Field(False, description="是否已有图片（*_images 里有 file_id 非空的行）")
    has_primary: bool = Field(False, description="是否已设为定版（上述行里有 is_primary）")
    thumbnail: str = Field("", description="当前首选图地址（空串 = 还没有图）")
    image_id: int | None = Field(None, description="当前首选图的行 ID（「设为定版」的默认目标）")


class ProjectAssetReadinessSummary(BaseModel):
    """顶部统计用的汇总（与逐项标志同一份数据算出来）。"""

    total: int = Field(0, description="参与准备的资产总数")
    asset_counts: dict[str, int] = Field(default_factory=dict, description="按类型分组的数量")
    with_image_prompt: int = Field(0, description="已保存图片提示词的资产数")
    with_image: int = Field(0, description="已有图片的资产数")
    with_primary: int = Field(0, description="已定版的资产数")
    done: int = Field(0, description="提示词 / 图片 / 定版齐全且无待确认候选的资产数")
    all_done: bool = Field(False, description="是否所有资产都已定版")


class ProjectAssetReadinessRead(BaseModel):
    """项目资产准备清单。"""

    project_id: str = Field(..., description="项目 ID")
    items: list[ProjectAssetReadinessItem] = Field(default_factory=list, description="逐资产准备状态")
    summary: ProjectAssetReadinessSummary = Field(
        default_factory=ProjectAssetReadinessSummary, description="汇总"
    )
