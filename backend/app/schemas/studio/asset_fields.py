"""分类资产的可编辑设定；完整 description 仅由后端派生。"""

from pydantic import BaseModel, ConfigDict, Field


class SupplementaryInfo(BaseModel):
    """保存未被分类字段覆盖的要求，同时拒绝旧描述及跨类别字段写入。"""

    model_config = ConfigDict(extra="forbid")
    supplementary_info: str = Field("", max_length=8000, description="补充信息")


class ActorFields(SupplementaryInfo):
    """Actor 的可空分类设定；未知值不自动推断。"""

    age_appearance: str | None = Field(None, max_length=200, description="外观年龄")
    gender: str | None = Field(None, max_length=200, description="性别设定")
    build: str | None = Field(None, max_length=200, description="体型")
    facial_features: str | None = Field(None, max_length=2000, description="五官特征")
    skin_tone: str | None = Field(None, max_length=200, description="肤色")
    hair: str | None = Field(None, max_length=2000, description="发型发色")


class SceneFields(SupplementaryInfo):
    """Scene 的可空分类设定；未知值不自动推断。"""

    scene_type: str | None = Field(None, max_length=200, description="场所类型")
    spatial_layout: str | None = Field(None, max_length=2000, description="空间布局")
    environment_features: str | None = Field(None, max_length=2000, description="环境特征")
    materials: str | None = Field(None, max_length=2000, description="主要材质")
    color_palette: str | None = Field(None, max_length=2000, description="色彩")


class PropFields(SupplementaryInfo):
    """Prop 的可空分类设定；未知值不自动推断。"""

    prop_type: str | None = Field(None, max_length=200, description="道具类型")
    shape: str | None = Field(None, max_length=2000, description="外形结构")
    size_description: str | None = Field(None, max_length=200, description="尺寸或相对尺度")
    materials: str | None = Field(None, max_length=2000, description="材质")
    colors: str | None = Field(None, max_length=2000, description="颜色")


class CostumeFields(SupplementaryInfo):
    """Costume 的可空分类设定；未知值不自动推断。"""

    costume_type: str | None = Field(None, max_length=200, description="服装类型")
    structure: str | None = Field(None, max_length=2000, description="款式层次")
    materials: str | None = Field(None, max_length=2000, description="材质")
    colors: str | None = Field(None, max_length=2000, description="颜色")
    patterns_accessories: str | None = Field(None, max_length=2000, description="纹样与附属配饰")
