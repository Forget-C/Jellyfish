"""文本模型失败回退策略。

设计取舍：
- 全局统一开关：`fallback_text_model_id` 配置在 `ModelSettings` 单例，所有 text 任务统一生效。
- 策略固定为“主模型最多失败 1 次 -> 回退模型最多 1 次”，避免循环重试放大成本与延迟。
- 鉴权、非法请求、内容拒绝、上下文超长等不可恢复错误不回退。
- 流式输出已经开始后不回退，避免向调用方输出重复或截断内容。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator
from contextvars import ContextVar
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.outputs import ChatGenerationChunk, ChatResult
from langchain_core.runnables import RunnableLambda

_FALLBACK_USED = ContextVar("text_fallback_used", default=False)
_CALL_DEPTH = ContextVar("text_fallback_call_depth", default=0)

_NON_FALLBACK_ERROR_TOKENS = (
    "authentication",
    "auth",
    "permission",
    "forbidden",
    "content_filter",
    "refusal",
    "context_length",
    "invalid_request",
    "bad_request",
    "not_found",
    "unsupported",
    "abort",
    "cancel",
    "user_cancelled",
)

_FALLBACK_ERROR_TOKENS = (
    "timeout",
    "timed out",
    "connection",
    "rate limit",
    "too many requests",
    "overloaded",
    "server error",
    "temporarily unavailable",
    "service unavailable",
    "429",
    "502",
    "503",
    "504",
    "parse",
    "failed to parse",
    "json-like",
    "empty output",
    "validation",
    "schema",
    "pydantic",
    "model_validate",
)


def begin_text_call() -> None:
    """标记一次文本调用开始，最外层调用时重置回退预算。"""
    depth = _CALL_DEPTH.get()
    if depth == 0:
        _FALLBACK_USED.set(False)
    _CALL_DEPTH.set(depth + 1)


def end_text_call() -> None:
    """标记一次文本调用结束，回到最外层时清理回退预算。"""
    depth = _CALL_DEPTH.get()
    if depth <= 1:
        _CALL_DEPTH.set(0)
        _FALLBACK_USED.set(False)
    else:
        _CALL_DEPTH.set(depth - 1)


def fallback_used_in_call() -> bool:
    """当前文本调用是否已经使用过回退模型。"""
    return _FALLBACK_USED.get()


def mark_fallback_used() -> None:
    """标记当前文本调用已经使用回退预算。"""
    _FALLBACK_USED.set(True)


def is_fallback_eligible_error(exc: BaseException) -> bool:
    """判断异常是否允许升级到回退模型。"""
    if isinstance(exc, (KeyboardInterrupt, asyncio.CancelledError)):
        return False

    status: int | None = None
    for attr in ("status_code", "status"):
        try:
            value = getattr(exc, attr)
        except Exception:
            continue
        if isinstance(value, int):
            status = value
            break

    if status is not None:
        if status in (400, 401, 403, 404, 422):
            return False
        if status == 429 or status >= 500:
            return True

    exc_name = exc.__class__.__name__.lower()
    if any(
        token in exc_name
        for token in ("timeout", "connection", "ratelimit", "rate_limit", "server", "overloaded", "unavailable")
    ):
        return True

    text = str(exc).lower()
    if any(token in text for token in _NON_FALLBACK_ERROR_TOKENS):
        return False
    if any(token in text for token in _FALLBACK_ERROR_TOKENS):
        return True
    return False


class FallbackChatModel(BaseChatModel):
    """把主模型与回退模型包装为一个 ChatModel，失败后最多升级一次。"""

    primary: BaseChatModel
    fallback: BaseChatModel | None

    def __init__(self, *, primary: BaseChatModel, fallback: BaseChatModel | None) -> None:
        super().__init__(primary=primary, fallback=fallback)

    @property
    def _llm_type(self) -> str:
        return "fallback_chat_model"

    def _try_fallback(self) -> BaseChatModel | None:
        if self.fallback is None or fallback_used_in_call():
            return None
        mark_fallback_used()
        return self.fallback

    def _generate(
        self,
        messages: list[Any],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        try:
            return self.primary._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
        except Exception as exc:  # noqa: BLE001
            if not is_fallback_eligible_error(exc):
                raise
            fallback = self._try_fallback()
            if fallback is None:
                raise
            return fallback._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    async def _agenerate(
        self,
        messages: list[Any],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        try:
            return await self.primary._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs)
        except Exception as exc:  # noqa: BLE001
            if not is_fallback_eligible_error(exc):
                raise
            fallback = self._try_fallback()
            if fallback is None:
                raise
            return await fallback._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs)

    def _stream(
        self,
        messages: list[Any],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        streamed = False
        try:
            for chunk in self.primary._stream(messages, stop=stop, run_manager=run_manager, **kwargs):
                streamed = True
                yield chunk
        except Exception as exc:  # noqa: BLE001
            if streamed or not is_fallback_eligible_error(exc):
                raise
            fallback = self._try_fallback()
            if fallback is None:
                raise
            for chunk in fallback._stream(messages, stop=stop, run_manager=run_manager, **kwargs):
                yield chunk

    async def _astream(
        self,
        messages: list[Any],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        streamed = False
        try:
            async for chunk in self.primary._astream(messages, stop=stop, run_manager=run_manager, **kwargs):
                streamed = True
                yield chunk
        except Exception as exc:  # noqa: BLE001
            if streamed or not is_fallback_eligible_error(exc):
                raise
            fallback = self._try_fallback()
            if fallback is None:
                raise
            async for chunk in fallback._astream(messages, stop=stop, run_manager=run_manager, **kwargs):
                yield chunk

    def bind_tools(
        self,
        tools: Any,
        *,
        tool_choice: Any = None,
        **kwargs: Any,
    ) -> Any:
        """将工具绑定委托给主/回退模型，返回带同样回退语义的 runnable。"""
        primary_bound = self.primary.bind_tools(tools, tool_choice=tool_choice, **kwargs)
        fallback_bound = (
            self.fallback.bind_tools(tools, tool_choice=tool_choice, **kwargs)
            if self.fallback is not None
            else None
        )

        def _invoke(input: Any, config: Any = None, **call_kwargs: Any) -> Any:
            try:
                return primary_bound.invoke(input, config=config, **call_kwargs)
            except Exception as exc:  # noqa: BLE001
                if not is_fallback_eligible_error(exc):
                    raise
                fallback = self._try_fallback()
                if fallback is None or fallback_bound is None:
                    raise
                return fallback_bound.invoke(input, config=config, **call_kwargs)

        async def _ainvoke(input: Any, config: Any = None, **call_kwargs: Any) -> Any:
            try:
                return await primary_bound.ainvoke(input, config=config, **call_kwargs)
            except Exception as exc:  # noqa: BLE001
                if not is_fallback_eligible_error(exc):
                    raise
                fallback = self._try_fallback()
                if fallback is None or fallback_bound is None:
                    raise
                return await fallback_bound.ainvoke(input, config=config, **call_kwargs)

        return RunnableLambda(_invoke, afunc=_ainvoke)
