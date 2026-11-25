"""供应商适配器和模型调用方共享的接口。"""

from __future__ import annotations

from dataclasses import dataclass, field
from collections.abc import AsyncGenerator
from typing import Any, Literal, Protocol, TypedDict, NotRequired, runtime_checkable

from app.core.contracts.model_catalog import ProviderModelCatalog


@dataclass(frozen=True, slots=True)
class ModelProviderConfig:
    """绑定适配器所用的服务地址和凭据。"""

    provider: str
    api_key: str = field(repr=False)
    base_url: str | None = None


class ModelProviderConfigurationError(ValueError):
    """供应商配置无法用于选定的操作。"""


class ModelProvider(Protocol):
    """模型供应商面向调用方提供的异步操作。"""

    async def list_models(self) -> ProviderModelCatalog:
        """查询配置对应的模型目录和来源。"""


class ProviderChatMessage(TypedDict):
    """支持多模态内容和工具调用 ID 的对话消息。"""

    role: Literal["system", "developer", "user", "assistant", "tool"]
    content: str | list[dict[str, Any]] | None
    tool_calls: NotRequired[list[dict[str, Any]]]
    tool_call_id: NotRequired[str]
    name: NotRequired[str]


@dataclass(frozen=True, slots=True)
class ProviderChatResult:
    """模型对话的完整回复，保留各候选以及供应商提供的用量。"""

    choices: list[ProviderChatEvent]
    usage: dict[str, Any] | None


@dataclass(frozen=True, slots=True)
class ProviderChatEvent:
    """一项原生对话增量、终止事件或可见调用失败。"""

    kind: Literal["delta", "completed", "error"]
    choice: int = 0
    text: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    finish_reason: str | None = None
    usage: dict[str, Any] | None = None
    error: str | None = None


@runtime_checkable
class TextModelProvider(Protocol):
    """通过当前配置调用已选定的文本模型。"""

    async def invoke(
        self, messages: list[ProviderChatMessage], *, options: dict[str, Any] | None = None,
    ) -> ProviderChatResult:
        """取得完整结果。"""

    def stream(
        self, messages: list[ProviderChatMessage], *, options: dict[str, Any] | None = None,
    ) -> AsyncGenerator[ProviderChatEvent, None]:
        """逐项交付供应商的原生增量。"""
