"""在同一文本供应商契约下映射 Responses 输入、输出和增量事件。"""

from __future__ import annotations

import httpx
from httpx_sse import SSEError, aconnect_sse

from app.core.contracts.model_provider import ProviderChatEvent, ProviderChatResult
from app.core.integrations.openai.chat import OpenAICompatibleChat


def _inputs(messages):
    """工具调用及结果是独立输入项，通过 call_id 关联。"""
    for message in messages:
        content = message["content"]
        role = message["role"]
        if role == "tool":
            yield {"type": "function_call_output", "call_id": message["tool_call_id"], "output": content}
            continue
        if isinstance(content, list):
            parts = []
            for block in content:
                if block["type"] == "text":
                    parts.append({"type": "output_text" if role == "assistant" else "input_text", "text": block["text"]})
                elif block["type"] == "image_url":
                    image = block["image_url"]
                    parts.append({"type": "input_image", "image_url": image["url"], "detail": image.get("detail", "auto")})
                else:
                    parts.append(block)
            content = parts
        if content or not message.get("tool_calls"):
            yield {"role": role, "content": content or ""}
        for call in message.get("tool_calls", []):
            yield {"type": "function_call", "call_id": call["id"], **call["function"]}


def _tool(tool):
    return {"type": "function", **tool["function"]} if "function" in tool else tool


def _usage(response):
    usage = response.get("usage")
    if usage:
        return {**usage, "prompt_tokens": usage.get("input_tokens"), "completion_tokens": usage.get("output_tokens")}
    return None


def _call(item):
    return {"id": item["call_id"], "type": "function",
            "function": {"name": item["name"], "arguments": item.get("arguments", "")}}


class OpenAIResponses(OpenAICompatibleChat):
    """共享连接配置，使用 Responses 的消息格式与终止事件。"""

    endpoint = "responses"

    def _payload(self, messages, options, *, stream):
        body = super()._payload(messages, options, stream=stream)
        if body.pop("use_previous_response_id", False):
            for index in range(len(messages) - 1, -1, -1):
                message = messages[index]
                if message["role"] == "assistant" and (response_id := message.get("response_id")):
                    body["previous_response_id"] = response_id
                    messages = messages[index + 1:]
                    break
        del body["messages"]
        body["input"] = list(_inputs(messages))
        body.pop("stream_options", None)
        body.pop("output_version", None)
        for key in ("max_tokens", "max_completion_tokens"):
            if key in body:
                body["max_output_tokens"] = body.pop(key)
        if "reasoning_effort" in body:
            body["reasoning"] = {"effort": body.pop("reasoning_effort"), **(body.get("reasoning") or {})}
        if self._model.startswith("gpt-5") and "chat" not in self._model and (body.get("reasoning") or {}).get("effort") != "none":
            body.pop("temperature", None)
        if "response_format" in body:
            fmt = body.pop("response_format")
            body["text"] = {**body.get("text", {}), "format": {"type": fmt["type"], **fmt.get("json_schema", {})}}
        if "tools" in body:
            body["tools"] = [_tool(tool) for tool in body["tools"]]
        if isinstance(body.get("tool_choice"), dict):
            body["tool_choice"] = _tool(body["tool_choice"])
        return body

    async def invoke(self, messages, *, options=None):
        async with self._client_factory() as client:
            raw = await client.post(self._url, headers=self._headers, params=self._query,
                                    json=self._payload(messages, options, stream=False))
            raw.raise_for_status()
            response = raw.json()
        if response.get("status") not in ("completed", "incomplete"):
            raise ValueError("Responses request did not produce a result")
        calls = [_call(item) for item in response["output"] if item["type"] == "function_call"]
        content = "".join(block.get("text") or block.get("refusal", "") for item in response["output"]
                          if item["type"] == "message" for block in item["content"])
        reason = "length" if response["status"] == "incomplete" else "tool_calls" if calls else "stop"
        return ProviderChatResult([ProviderChatEvent("completed", text=content, tool_calls=calls, finish_reason=reason,
                                                     response_id=response.get("id"))],
                                  _usage(response))

    async def stream(self, messages, *, options=None):
        has_calls = False
        try:
            async with self._client_factory() as client, aconnect_sse(
                client, "POST", self._url, headers=self._headers, params=self._query,
                json=self._payload(messages, options, stream=True),
            ) as source:
                source.response.raise_for_status()
                async for frame in source.aiter_sse():
                    event = frame.json()
                    kind = event["type"]
                    if kind in ("response.output_text.delta", "response.refusal.delta"):
                        yield ProviderChatEvent("delta", text=event["delta"])
                    elif kind == "response.output_item.added" and event["item"]["type"] == "function_call":
                        has_calls = True
                        yield ProviderChatEvent("delta", tool_calls=[{"index": event["output_index"], **_call(event["item"])}])
                    elif kind == "response.function_call_arguments.delta":
                        yield ProviderChatEvent("delta", tool_calls=[{"index": event["output_index"],
                                                                     "function": {"arguments": event["delta"]}}])
                    elif kind in ("response.completed", "response.incomplete"):
                        reason = "length" if kind == "response.incomplete" else "tool_calls" if has_calls else "stop"
                        yield ProviderChatEvent("completed", finish_reason=reason, usage=_usage(event["response"]),
                                                response_id=event["response"].get("id"))
                        return
                    elif kind in ("response.failed", "error"):
                        yield ProviderChatEvent("error", error="Provider reported a Responses error")
                        return
        except (httpx.HTTPError, SSEError, KeyError, TypeError, ValueError):
            yield ProviderChatEvent("error", error="Provider Responses stream could not be read")
            return
        yield ProviderChatEvent("error", error="Provider Responses stream ended without a result")
