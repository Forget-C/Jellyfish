"""供应商模型目录的跨层共享契约。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.llm import ModelCategoryKey

ModelCatalogSource = Literal["provider_api", "provider_catalog"]


class ProviderModelCandidate(BaseModel):
    """可从供应商目录导入的一项模型，不包含任何密钥或供应商配置。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, description="供应商模型名称")
    category: ModelCategoryKey = Field(..., description="模型类别")
    description: str = Field("", description="供应商能力说明")
    params: dict[str, object] = Field(default_factory=dict, description="建议写入模型配置的默认参数")


class ProviderModelCatalog(BaseModel):
    """一次模型目录刷新结果，声明来源以区分实时 API 与官方目录。"""

    model_config = ConfigDict(extra="forbid")

    provider_key: str = Field(..., description="供应商稳定键")
    source: ModelCatalogSource = Field(..., description="模型列表来源")
    models: list[ProviderModelCandidate] = Field(default_factory=list, description="可导入模型")
