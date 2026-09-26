"""资产级声音绑定的读写契约（需求清单第 6 条）。

字段口径（都进主区，因此**不含** file_id 这类内部标识的必要性说明见下）：

- ``asset_type`` / ``asset_id``：这一条绑定属于哪个资产（机器可读，页面用它定位卡片）；
- ``asset_label``：资产类型的中文名（页面直接显示，不让页面自己写映射）；
- ``bound``：这一项**有没有**绑定声音（``false`` 时下面几个字段全是空串，
  页面据此显示"还没绑定声音"，而不是显示一个空文件名）；
- ``file_id`` / ``file_name``：声音文件。``file_id`` 是内部标识，
  **只允许落在技术详情层**（前端按既有审计口径处理，不在主区直渲）。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class AssetVoiceBindRequest(BaseModel):
    """绑定请求：把一个音频文件绑成某个资产的声音。"""

    file_id: str = Field(..., description="要绑定的音频文件 ID（files.type 必须是 audio）")


class AssetVoiceRead(BaseModel):
    """一条资产级声音绑定（只读）。"""

    asset_type: str = Field(..., description="资产类型：character / scene / prop / costume")
    asset_id: str = Field(..., description="资产 ID")
    asset_label: str = Field("", description="资产类型的中文名（页面直接显示）")
    bound: bool = Field(False, description="这一项是否已绑定声音")
    file_id: str = Field("", description="声音文件 ID（内部标识，只进技术详情层）")
    file_name: str = Field("", description="声音文件名")
    url: str = Field("", description="声音文件地址（是否可进供应商请求由生成前的准入判定负责）")


class AssetVoiceClearRead(BaseModel):
    """解绑结果。"""

    removed: int = Field(0, description="被清掉的绑定行数（0 = 本来就没绑）")
