"""资产图生成的参考用途和展示输入契约。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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


class AssetPromptOptions(BaseModel):
    """单次生图的展示设置，不允许覆盖资产身份、风格和槽位视角。"""

    model_config = ConfigDict(extra="forbid")
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
