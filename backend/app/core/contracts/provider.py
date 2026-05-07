"""生成能力共享的供应商类型契约。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ProviderKey = Literal["openai", "volcengine", "aliyun_bailian"]


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    """执行生成任务时需要的供应商配置。"""

    provider: ProviderKey
    api_key: str
    base_url: str | None = None
