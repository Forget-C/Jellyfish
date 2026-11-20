"""演员图片（ActorImage）schemas。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.contracts.asset_prompts import validate_display_overrides

from app.models.studio import AssetQualityLevel, AssetViewAngle


class ActorImageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: str
    quality_level: AssetQualityLevel = AssetQualityLevel.low
    view_angle: AssetViewAngle = AssetViewAngle.front
    is_view_default: bool = False
    is_primary: bool = False
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str = "png"
    prompt_overrides: dict[str, str] = Field(default_factory=dict, description="此图片的展示提示词变量覆盖")


class ActorImageCreate(BaseModel):
    """创建演员图片槽位，并允许预设该视图的展示变量覆盖。"""

    quality_level: AssetQualityLevel = AssetQualityLevel.low
    view_angle: AssetViewAngle = AssetViewAngle.front
    is_view_default: bool = False
    is_primary: bool = False
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str = "png"
    prompt_overrides: dict[str, str] = Field(default_factory=dict)


    @field_validator("prompt_overrides")
    @classmethod
    def _validate_overrides(cls, value):
        """图片级设置仅允许调整展示方式。"""
        return validate_display_overrides(value)


class ActorImageUpdate(BaseModel):
    """局部更新演员图片槽位；覆盖仅作用于当前图片。"""

    is_view_default: bool = False
    is_primary: bool = False
    quality_level: AssetQualityLevel | None = None
    view_angle: AssetViewAngle | None = None
    file_id: str | None = None
    width: int | None = None
    height: int | None = None
    format: str | None = None
    prompt_overrides: dict[str, str] | None = None


    @field_validator("prompt_overrides")
    @classmethod
    def _validate_overrides(cls, value):
        """图片级设置仅允许调整展示方式。"""
        return validate_display_overrides(value)
