"""资产图生成的参考用途和展示输入契约。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.models.types import AssetViewAngle, ProjectStyle, ProjectVisualStyle

AssetReferenceRole = Literal["identity", "costume", "prop", "layout", "style", "design"]
DISPLAY_FIELDS = frozenset({
    "framing_instruction", "background_instruction", "lighting_instruction",
    "visible_detail_instruction", "negative_prompt",
})


class AssetPromptReference(BaseModel):
    """一张参考图的明确用途；去重时同一文件可以保留多个用途。"""

    model_config = ConfigDict(extra="forbid")
    file_id: str = Field(min_length=1)
    role: AssetReferenceRole
    source_kind: Literal["actor", "character", "scene", "prop", "costume"] | None = None
    source_id: str | None = Field(None, min_length=1)
    source_image_id: int | None = Field(None, ge=1)
    view_angle: AssetViewAngle | None = None

    @model_validator(mode="after")
    def require_concrete_source_image(self):
        """对象来源须明确到图片行，上传参考则不伪造来源对象。"""
        source = (self.source_kind, self.source_id, self.source_image_id)
        if any(value is not None for value in source) and not all(value is not None for value in source):
            raise ValueError("对象参考必须同时提供来源类别、对象和具体图片")
        return self


class AssetPromptOptions(BaseModel):
    """单次生图设置；临时风格仅用于图片来源对象，不覆盖档案或槽位视角。"""

    model_config = ConfigDict(extra="forbid")
    style: ProjectStyle | None = None
    visual_style: ProjectVisualStyle | None = None
    mode: Literal["generate", "edit"] = "generate"
    edit_instruction: str = Field("", max_length=2000, description="局部修改的对象和目标效果")
    preserve_instruction: str = Field("", max_length=2000, description="局部修改时明确保持的内容")
    references: list[AssetPromptReference] | None = Field(None, description="未传使用推荐图；空列表明确不用参考图")
    framing_instruction: str | None = Field(None, max_length=2000, description="构图")
    background_instruction: str | None = Field(None, max_length=2000, description="背景")
    lighting_instruction: str | None = Field(None, max_length=2000, description="灯光")
    visible_detail_instruction: str | None = Field(None, max_length=2000, description="细节强调")
    negative_prompt: str | None = Field(None, max_length=2000, description="排除内容")
    additional_instruction: str = Field("", max_length=4000, description="本次附加要求，不回写资产")


def validate_display_overrides(value: dict[str, str] | None) -> dict[str, str] | None:
    """拒绝展示范围之外的覆盖，避免自由键值偷偷改写主体和参考说明。"""
    if value is None:
        return value
    unknown = set(value) - DISPLAY_FIELDS
    if unknown:
        raise ValueError("不允许覆盖资产设定或参考关系：" + ", ".join(sorted(unknown)))
    if any(len(text) > 2000 for text in value.values()):
        raise ValueError("展示要求不能超过2000字符")
    return value


class AssetPromptAudit(BaseModel):
    """提交时冻结的渲染元数据；用于重现输入，不作为授权或模板真实性证明。"""

    model_config = ConfigDict(extra="forbid")
    render_id: str
    template_id: str | None = None
    template_version: int | None = None
    variables: dict[str, str]
    execution_prompt: str
    reference_file_ids: list[str]
