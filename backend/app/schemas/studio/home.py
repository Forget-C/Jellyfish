"""首页只读摘要的公开响应。"""
from typing import Literal

from pydantic import AwareDatetime, BaseModel

LibraryAssetType = Literal["actor", "scene", "prop", "costume"]


class HomeRecentCanvas(BaseModel):
    """首页画布卡片所需的名称、归属及封面。"""

    id: str
    kind: Literal["free", "scene"]
    name: str
    updated_at: AwareDatetime
    cover_file_id: str | None
    project_name: str | None


class HomeRecentAsset(BaseModel):
    """跨分类排序后的资产库条目。"""

    id: str
    type: LibraryAssetType
    name: str
    updated_at: AwareDatetime
    thumbnail: str | None
