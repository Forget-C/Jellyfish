"""OpenAI 兼容的 Chat Completions 文本操作。"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from contextlib import AbstractAsyncContextManager
from typing import Any

import httpx
from httpx_sse import SSEError, aconnect_sse

from app.core.contracts.model_provider import (
    ModelProviderConfig,
    ModelProviderConfigurationError,
    ProviderChatEvent,
    ProviderChatMessage,
    ProviderChatResult,
)


class OpenAICompatibleChat:
    """绑定文本模型与配置，并在每次异步调用期间管理 HTTP 连接。"""

    def __init__(
        self,
        config: ModelProviderConfig,
        model: str,
        params: dict[str, Any],
        client_factory: Callable[[], AbstractAsyncContextManager[httpx.AsyncClient]],
    ) -> None:
        if not config.base_url:
            raise ModelProviderConfigurationError(f"Provider {config.provider} has no chat base URL")
        self._url = f"{config.base_url.rstrip('/')}/chat/completions"
        self._model = model
        self._client_factory = client_factory
        self._headers = {**(params.get("default_headers") or {}), "Authorization": f"Bearer {config.api_key}"}
        self._query = params.get("default_query")
        self._body = {
            key: value for key, value in params.items() if key not in {
                "default_headers", "default_query", "model_kwargs", "extra_body", "request_timeout",
                "timeout", "max_retries", "streaming", "use_responses_api", "stream_usage",
                "callbacks", "tags", "metadata", "verbose", "cache", "disable_streaming",
                "api_key", "openai_api_key", "openai_api_base", "base_url",
                "http_client", "http_async_client", "openai_organization", "organization", "openai_proxy",
            }
        }
        self._body.update(params.get("model_kwargs") or {})
        self._body.update(params.get("extra_body") or {})
        self._stream_usage = bool(params.get("stream_usage"))
        organization = params.get("organization") or params.get("openai_organization")
        if organization:
            self._headers.setdefault("OpenAI-Organization", organization)

    def _payload(
        self, messages: list[ProviderChatMessage], options: dict[str, Any] | None, *, stream: bool,
    ) -> dict[str, Any]:
        body = {
            **self._body, **(options or {}), "model": self._model, "messages": messages, "stream": stream,
        }
        if stream and self._stream_usage:
            body.setdefault("stream_options", {"include_usage": True})
        return body

    async def invoke(
        self, messages: list[ProviderChatMessage], *, options: dict[str, Any] | None = None,
    ) -> ProviderChatResult:
        async with self._client_factory() as client:
            response = await client.post(
                self._url, headers=self._headers, params=self._query,
                json=self._payload(messages, options, stream=False),
            )
            response.raise_for_status()
        payload = response.json()
        return ProviderChatResult(
            choices=[_choice(choice, streaming=False) for choice in payload["choices"]],
            usage=payload.get("usage"),
        )

    async def stream(
        self, messages: list[ProviderChatMessage], *, options: dict[str, Any] | None = None,
    ) -> AsyncGenerator[ProviderChatEvent, None]:
        finished: dict[int, str | None] = {}
        seen: set[int] = set()
        usage = None
        try:
            async with self._client_factory() as client, aconnect_sse(
                client, "POST", self._url, headers=self._headers, params=self._query,
                json=self._payload(messages, options, stream=True),
            ) as source:
                source.response.raise_for_status()
                media_type = source.response.headers.get("content-type", "").split(";", 1)[0]
                if media_type in ("", "text/plain"):
                    source.response.headers["content-type"] = "text/event-stream"
                async for event in source.aiter_sse():
                    if event.data == "[DONE]":
                        for index in sorted(seen):
                            finished.setdefault(index, None)
                        break
                    if event.event == "error":
                        yield ProviderChatEvent(kind="error", error="Provider reported a stream error")
                        return
                    if not event.data:
                        continue
                    chunk = event.json()
                    if "error" in chunk:
                        yield ProviderChatEvent(kind="error", error="Provider reported a stream error")
                        return
                    usage = chunk.get("usage") or usage
                    for choice in chunk.get("choices") or []:
                        delta = _choice(choice, streaming=True)
                        seen.add(delta.choice)
                        if delta.text or delta.tool_calls:
                            yield delta
                        if delta.finish_reason:
                            finished[delta.choice] = delta.finish_reason
        except (httpx.HTTPError, SSEError, ValueError, TypeError, AttributeError):
            yield ProviderChatEvent(kind="error", error="Provider stream could not be read")
            return

        if not finished:
            yield ProviderChatEvent(kind="error", error="Provider stream ended without a result")
            return
        for choice_index, reason in finished.items():
            yield ProviderChatEvent(kind="completed", choice=choice_index, finish_reason=reason, usage=usage)


def _choice(choice: dict[str, Any], *, streaming: bool) -> ProviderChatEvent:
    message = choice.get("delta" if streaming else "message") or {}
    return ProviderChatEvent(
        kind="delta" if streaming else "completed",
        choice=choice.get("index", 0),
        text=message.get("content") or "",
        tool_calls=message.get("tool_calls") or [],
        finish_reason=choice.get("finish_reason"),
    )
