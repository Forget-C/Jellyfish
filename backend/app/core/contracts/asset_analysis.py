"""资产整理的结构化建议契约；推断与原文事实分离，结果不直接写库。"""

from typing import ClassVar, Literal, Self
from pydantic import BaseModel, ConfigDict, Field, model_validator


class AssetFieldSuggestion(BaseModel):
    """单字段候选及来源；明确事实必须提供可核对的原文证据。"""

    model_config = ConfigDict(extra="forbid")
    field: str
    value: str = Field(min_length=1, max_length=8000)
    source: Literal["explicit", "inferred"]
    evidence: str = Field("", description="explicit 时必须为输入原文片段")


class AssetAnalysisResult(BaseModel):
    """校验候选字段范围、重复项和原文依据，防止含糊候选变成资产事实。"""

    model_config = ConfigDict(extra="forbid")
    field_limits: ClassVar[dict[str, int]] = {}
    issues: list[str] = Field(default_factory=list)
    suggestions: list[AssetFieldSuggestion] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_suggestions(self) -> Self:
        """仅接收该类别已声明的字段，每个字段最多一个建议。"""
        seen = set()
        for item in self.suggestions:
            if item.field not in self.field_limits or item.field in seen:
                raise ValueError("建议字段不存在或重复：" + item.field)
            if len(item.value) > self.field_limits[item.field]:
                raise ValueError("建议值超过字段长度：" + item.field)
            if item.source == "explicit" and not item.evidence.strip():
                raise ValueError("原文事实必须提供证据")
            seen.add(item.field)
        return self

    def verify_evidence(self, source_text: str) -> Self:
        """拒绝伪造的原文引用；不将引用存在等同于推断内容必然正确。"""
        for item in self.suggestions:
            if item.source == "explicit" and item.evidence not in source_text:
                raise ValueError("建议证据不在输入原文中：" + item.field)
        return self


class CharacterPortraitAnalysisResult(AssetAnalysisResult):
    """Actor 分类设定整理结果。"""

    field_limits: ClassVar[dict[str, int]] = {'age_appearance': 200, 'gender': 200, 'build': 200, 'facial_features': 2000, 'skin_tone': 200, 'hair': 2000, 'supplementary_info': 8000}


class SceneInfoAnalysisResult(AssetAnalysisResult):
    """Scene 分类设定整理结果。"""

    field_limits: ClassVar[dict[str, int]] = {'scene_type': 200, 'spatial_layout': 2000, 'environment_features': 2000, 'materials': 2000, 'color_palette': 2000, 'supplementary_info': 8000}


class PropInfoAnalysisResult(AssetAnalysisResult):
    """Prop 分类设定整理结果。"""

    field_limits: ClassVar[dict[str, int]] = {'prop_type': 200, 'shape': 2000, 'size_description': 200, 'materials': 2000, 'colors': 2000, 'supplementary_info': 8000}


class CostumeInfoAnalysisResult(AssetAnalysisResult):
    """Costume 分类设定整理结果。"""

    field_limits: ClassVar[dict[str, int]] = {'costume_type': 200, 'structure': 2000, 'materials': 2000, 'colors': 2000, 'patterns_accessories': 2000, 'supplementary_info': 8000}
