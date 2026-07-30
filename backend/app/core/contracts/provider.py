"""生成能力共享的供应商类型契约。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

#: 受支持的供应商标识。
#: ``comfyui`` 为自托管推理服务：无 API key，凭 base_url 直连，见
#: ``app.core.integrations.comfyui``。
ProviderKey = Literal["openai", "volcengine", "comfyui"]


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    """执行生成任务时需要的供应商配置。"""

    provider: ProviderKey
    api_key: str
    base_url: str | None = None
