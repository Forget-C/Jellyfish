"""可恢复远端 Provider 操作的中立状态契约。"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ProviderOperationStatus(str, Enum):
    """ProviderOperation 的远端副作用状态，不与本地 Task 终态混用。"""

    not_started = "not_started"
    create_uncertain = "create_uncertain"
    accepted = "accepted"
    polling = "polling"
    succeeded_remote = "succeeded_remote"
    failed_remote = "failed_remote"
    cancel_requested_remote = "cancel_requested_remote"
    cancelled_remote = "cancelled_remote"
    unknown = "unknown"


class ProviderCreateUncertainError(RuntimeError):
    """create 已发起但未取得可持久化 receipt，禁止自动重发。"""


@dataclass(frozen=True, slots=True)
class ProviderOperationRemoteReceipt:
    """可持久化的远端身份，不保存下载 URL、凭据或 Provider 原始响应。

    ``remote_id`` 是单次 poll、受控媒体解析与取消唯一可跨进程读取的远端定位符；
    下载地址必须在运行期由对应 Provider adapter 重新解析。
    """

    remote_id: str
    remote_status: str | None = None

    def to_storage_value(self) -> dict[str, str]:
        """生成 JSON 可存储值，字段白名单避免原始响应泄漏。"""
        value = {"remote_id": self.remote_id}
        if self.remote_status:
            value["remote_status"] = self.remote_status
        return value

    @classmethod
    def from_storage_value(cls, value: object) -> "ProviderOperationRemoteReceipt | None":
        """从历史 JSON 读取白名单字段，拒绝缺失或空白 remote ID。"""
        if not isinstance(value, dict):
            return None
        remote_id = value.get("remote_id")
        if not isinstance(remote_id, str) or not remote_id.strip():
            return None
        remote_status = value.get("remote_status")
        return cls(
            remote_id=remote_id.strip(),
            remote_status=remote_status.strip() if isinstance(remote_status, str) and remote_status.strip() else None,
        )


__all__ = ["ProviderCreateUncertainError", "ProviderOperationRemoteReceipt", "ProviderOperationStatus"]
