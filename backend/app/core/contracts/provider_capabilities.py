"""ProviderOperation 的能力化恢复契约。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ProviderOperationCapabilities:
    """描述已验证的远端操作能力，unknown 不得推断为支持。"""

    supports_remote_handle: bool
    supports_poll_by_handle: bool
    supports_result_retrieval_by_handle: bool = False
    supports_remote_cancel: bool = False
    supports_create_idempotency: bool = False
    supports_client_key_lookup: bool = False


_UNRECOVERABLE = ProviderOperationCapabilities(False, False)
_RECOVERABLE_POLL = ProviderOperationCapabilities(True, True, True)


def provider_operation_capabilities(*, provider_key: str, operation_kind: str) -> ProviderOperationCapabilities:
    """返回项目已验证的能力；未登记的组合一律走最保守的不可恢复策略。"""
    if operation_kind == "video_generation" and provider_key in {"openai", "volcengine", "vidu", "kling"}:
        return _RECOVERABLE_POLL
    if operation_kind == "image_generation" and provider_key in {"vidu", "kling"}:
        return _RECOVERABLE_POLL
    return _UNRECOVERABLE


__all__ = ["ProviderOperationCapabilities", "provider_operation_capabilities"]
