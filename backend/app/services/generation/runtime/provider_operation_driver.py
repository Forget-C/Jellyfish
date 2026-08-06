"""ProviderOperation 的能力化 create / poll / cancel Driver 协议。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.core.contracts.provider_capabilities import ProviderOperationCapabilities


@dataclass(frozen=True, slots=True)
class ProviderOperationReceipt:
    """远端创建或查询后可持久化的最小 receipt，不携带 Provider 原始响应。"""

    remote_id: str | None
    remote_status: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderPollResult:
    """单次 poll 的中立结果；完成载荷仅在当前 Worker 内存中交给领域 Driver。"""

    remote_status: str
    terminal: bool
    succeeded: bool
    cancelled: bool = False
    output: object | None = None


class ProviderOperationDriver(Protocol):
    """将 Provider 的副作用限定为可能力化的 start、poll 与可选 cancel。"""

    capabilities: ProviderOperationCapabilities

    async def start_or_recover(self, *, remote_id: str | None) -> ProviderOperationReceipt:
        """创建新远端操作或返回已知 receipt；create-unknown 必须由实现显式抛出。"""

    async def poll(self, *, remote_id: str) -> ProviderPollResult:
        """执行一次 poll，不负责本地 Task、Artifact 或领域投影。"""

    async def request_cancel(self, *, remote_id: str) -> bool:
        """请求远端取消；不支持时返回 False，禁止伪造远端已取消。"""


__all__ = ["ProviderOperationDriver", "ProviderOperationReceipt", "ProviderPollResult"]
