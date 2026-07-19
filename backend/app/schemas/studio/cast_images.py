"""演员图片（ActorImage）schemas。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.studio import AssetQualityLevel, AssetViewAngle


class ActorImageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: str
    quality_level: AssetQualityLevel = AssetQualityLevel.low
    view_angle: AssetViewAngle = AssetViewAngle.front
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str = "png"
    prompt_overrides: dict[str, str] = Field(default_factory=dict, description="此图片的展示提示词变量覆盖")


class ActorImageCreate(BaseModel):
    """创建演员图片槽位，并允许预设该视图的展示变量覆盖。"""

    quality_level: AssetQualityLevel = AssetQualityLevel.low
    view_angle: AssetViewAngle = AssetViewAngle.front
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str = "png"
    prompt_overrides: dict[str, str] = Field(default_factory=dict)


class ActorImageUpdate(BaseModel):
    """局部更新演员图片槽位；覆盖仅作用于当前图片。"""

    quality_level: AssetQualityLevel | None = None
    view_angle: AssetViewAngle | None = None
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str | None = None
    prompt_overrides: dict[str, str] | None = None
