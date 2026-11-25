"""LangChain 接入层，将 Agent 对话映射到异步供应商操作。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator, Sequence
from contextlib import aclosing, nullcontext
from typing import Annotated, Any, cast

import httpx
from langchain_core.output_parsers import JsonOutputParser, PydanticOutputParser

from langchain_core.language_models.chat_models import BaseChatModel, agenerate_from_stream
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, convert_to_openai_messages
from langchain_core.messages.ai import UsageMetadata
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.runnables import RunnableLambda, RunnableMap, RunnablePassthrough
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import BaseModel, ConfigDict, Field

from app.core.contracts.model_provider import ModelProviderConfig, ProviderChatEvent, ProviderChatMessage, TextModelProvider
from app.core.integrations.model_provider_registry import bind_text_provider


class LangChainChatModelAdapter(BaseChatModel):
    """为使用工具、回调和结构化输出的 Agent 提供 BaseChatModel。"""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    provider: Annotated[TextModelProvider, Field(exclude=True, repr=False)]
    model_name: str
    streaming: bool = False
    tools_available: bool = False

    @property
    def _llm_type(self) -> str:
        return "model-provider"

    @property
    def _identifying_params(self) -> dict[str, Any]:
        return {"model": self.model_name}

    def bind_tools(self, tools: Sequence, *, tool_choice=None, strict=None, **kwargs):
        """将 LangChain 工具定义和选择规则转换为 Chat Completions 参数。"""
        if tools and not self.tools_available:
            raise ValueError("The model has no effective tool-calling capability")
        if tool_choice == "any" or tool_choice is True:
            tool_choice = "required"
        elif isinstance(tool_choice, str) and tool_choice not in ("auto", "none", "required"):
            tool_choice = {"type": "function", "function": {"name": tool_choice}}
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
        return self.bind(tools=[convert_to_openai_tool(tool, strict=strict) for tool in tools], **kwargs)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        return asyncio.run(self._agenerate(messages, stop=stop, **kwargs))

    def _stream(self, messages, stop=None, run_manager=None, **kwargs) -> Iterator[ChatGenerationChunk]:
        """让同步 Agent 的线程逐段等待同一原生异步流。"""
        with asyncio.Runner() as runner:
            events = self._astream(messages, stop=stop, **kwargs)
            try:
                while True:
                    yield runner.run(anext(events))
            except StopAsyncIteration:
                return
            finally:
                runner.run(events.aclose())

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        if self.streaming:
            return await agenerate_from_stream(self._astream(messages, stop=stop, run_manager=run_manager, **kwargs))
        result = await self.provider.invoke(_messages(messages), options=_options(stop, kwargs))
        return ChatResult(
            generations=[
                ChatGeneration(
                    message=AIMessage(
                        content=choice.text,
                        additional_kwargs={"tool_calls": choice.tool_calls} if choice.tool_calls else {},
                        usage_metadata=_usage(result.usage),
                    ),
                    generation_info={"finish_reason": choice.finish_reason},
                )
                for choice in result.choices
            ],
            llm_output={"model_name": self.model_name, "token_usage": result.usage or {}},
        )

    async def _astream(
        self, messages, stop=None, run_manager=None, **kwargs,
    ) -> AsyncIterator[ChatGenerationChunk]:
        async with aclosing(self.provider.stream(_messages(messages), options=_options(stop, kwargs))) as events:
            async for event in events:
                if event.kind == "error":
                    raise RuntimeError(event.error or "Text model stream failed")
                if event.choice == 0:
                    chunk = _chunk(event)
                    if run_manager is not None:
                        await run_manager.on_llm_new_token(event.text, chunk=chunk)
                    yield chunk

    def with_structured_output(
        self, schema, *, include_raw=False, method="function_calling", strict=None, **kwargs,
    ):
        """将结构化输出要求映射为工具调用、JSON 对象或 JSON Schema。"""
        if method == "function_calling":
            return super().with_structured_output(schema, include_raw=include_raw, **kwargs)
        if method == "json_schema":
            definition = convert_to_openai_tool(schema, strict=strict)["function"]
            definition["schema"] = definition.pop("parameters")
            response_format = {"type": "json_schema", "json_schema": definition}
        elif method == "json_mode":
            response_format = {"type": "json_object"}
        else:
            raise ValueError(f"Unsupported structured output method: {method!r}")
        model = self.bind(response_format=response_format, **kwargs)
        parser = PydanticOutputParser(pydantic_object=schema) if isinstance(schema, type) and issubclass(schema, BaseModel) else JsonOutputParser()
        if not include_raw:
            return model | parser
        parsed = RunnablePassthrough.assign(parsed=RunnableLambda(lambda value: value["raw"]) | parser,
                                            parsing_error=RunnableLambda(lambda _: None))
        fallback = RunnablePassthrough.assign(parsed=RunnableLambda(lambda _: None))
        return RunnableMap(raw=model) | parsed.with_fallbacks([fallback], exception_key="parsing_error")


def build_langchain_chat(*, provider_key: str, tools_available: bool = False, **params: Any) -> BaseChatModel:
    """适配已解析的配置，显式选择 Responses API 时保留该协议的兼容客户端。"""
    if params.get("use_responses_api"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(**params)

    model_name = params["model"]
    config = ModelProviderConfig(provider_key, params["api_key"], params.get("base_url"))
    shared_client = params.get("http_async_client")
    timeout = params.get("timeout", params.get("request_timeout", 30.0))
    provider = bind_text_provider(
        config, model_name, params,
        client_factory=lambda: nullcontext(shared_client) if shared_client is not None else httpx.AsyncClient(timeout=timeout),
    )
    return LangChainChatModelAdapter(
        provider=provider, model_name=model_name,
        tools_available=tools_available,
        disable_streaming=params.get("disable_streaming", False), callbacks=params.get("callbacks"),
        tags=params.get("tags"), metadata=params.get("metadata"),
        **({"streaming": bool(params["streaming"])} if "streaming" in params else {}),
    )


def _messages(messages: list[BaseMessage]) -> list[ProviderChatMessage]:
    return [
        cast(ProviderChatMessage, converted)
        for message in messages
        for converted in convert_to_openai_messages(
            [message], text_format="block" if isinstance(message.content, list) else "string",
        )
    ]


def _options(stop: list[str] | None, options: dict[str, Any]) -> dict[str, Any]:
    payload = {key: value for key, value in options.items() if not key.startswith("ls_")}
    if stop is not None:
        payload["stop"] = stop
    return payload


def _usage(value: dict[str, Any] | None) -> UsageMetadata | None:
    if value is None:
        return None
    return UsageMetadata(
        input_tokens=value.get("prompt_tokens") or 0,
        output_tokens=value.get("completion_tokens") or 0,
        total_tokens=value.get("total_tokens") or 0,
    )


def _chunk(event: ProviderChatEvent) -> ChatGenerationChunk:
    return ChatGenerationChunk(
        message=AIMessageChunk(
            content=event.text, usage_metadata=_usage(event.usage),
            tool_call_chunks=[
                {
                    "index": call.get("index"),
                    "id": call.get("id"),
                    "name": (call.get("function") or {}).get("name"),
                    "args": (call.get("function") or {}).get("arguments"),
                    "type": "tool_call_chunk",
                }
                for call in event.tool_calls
            ],
        ),
        generation_info={"finish_reason": event.finish_reason} if event.kind == "completed" else None,
    )
