from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class EntityNameExistenceCheckRequest(BaseModel):
    """批量检测项目内/全局资产名称是否存在（模糊匹配）。"""

    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(..., description="项目 ID（必填）", min_length=1)

    character_names: list[str] = Field(default_factory=list, description="角色名称列表")
    prop_names: list[str] = Field(default_factory=list, description="道具名称列表")
    scene_names: list[str] = Field(default_factory=list, description="场景名称列表")
    costume_names: list[str] = Field(default_factory=list, description="服装名称列表")


class EntityNameExistenceItem(BaseModel):
    """单个名称的存在性结果。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., description="输入名称（原样回传）")
    exists: bool = Field(..., description="数据库中是否存在（模糊命中）")
    linked_to_project: bool = Field(..., description="是否已关联到该项目（角色等同于 exists）")

    asset_id: str | None = Field(None, description="命中的资产 ID（如 prop_id/scene_id/costume_id/character_id）")
    link_id: int | None = Field(None, description="若已关联到项目，对应 Project*Link 的 id；否则为空")


class EntityNameExistenceCheckResponse(BaseModel):
    """批量存在性检测结果（按资产类型分组）。"""

    model_config = ConfigDict(extra="forbid")

    characters: list[EntityNameExistenceItem] = Field(default_factory=list)
    props: list[EntityNameExistenceItem] = Field(default_factory=list)
    scenes: list[EntityNameExistenceItem] = Field(default_factory=list)
    costumes: list[EntityNameExistenceItem] = Field(default_factory=list)
