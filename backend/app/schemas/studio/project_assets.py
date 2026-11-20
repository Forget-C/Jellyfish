"""项目与章节资产关联契约。"""
from pydantic import BaseModel, ConfigDict, Field


class ProjectLinkBase(BaseModel):
    id: int = Field(..., description="关联行 ID")
    project_id: str = Field(..., description="项目 ID")
    chapter_id: str | None = Field(None, description="章节 ID（可空）")


class ProjectAssetLinkCreate(BaseModel):
    """资产关联以项目和可选章节为范围，不接受旧镜头目标。"""

    model_config = ConfigDict(extra="forbid")
    project_id: str
    chapter_id: str | None = None
    asset_id: str = Field(description="本项目专属对象 ID；库中对象须先导入独立副本")


class ProjectActorLinkRead(ProjectLinkBase):
    model_config = ConfigDict(from_attributes=True)

    actor_id: str
    thumbnail: str = Field("", description="演员缩略图下载地址")


class ProjectSceneLinkRead(ProjectLinkBase):
    model_config = ConfigDict(from_attributes=True)

    scene_id: str
    thumbnail: str = Field("", description="场景缩略图下载地址")


class ProjectPropLinkRead(ProjectLinkBase):
    model_config = ConfigDict(from_attributes=True)

    prop_id: str
    thumbnail: str = Field("", description="道具缩略图下载地址")


class ProjectCostumeLinkRead(ProjectLinkBase):
    model_config = ConfigDict(from_attributes=True)

    costume_id: str
    thumbnail: str = Field("", description="服装缩略图下载地址")
