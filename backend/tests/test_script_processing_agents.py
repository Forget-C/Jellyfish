"""Script processing agents parsing regression tests."""

from __future__ import annotations

import pytest

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app.chains.agents import ConsistencyCheckerAgent
from app.schemas.skills.script_processing import ScriptConsistencyCheckResult


class _MockChatModel(BaseChatModel):
    def __init__(self, response: str) -> None:
        super().__init__()
        self._response = response

    @property
    def _llm_type(self) -> str:  # pragma: no cover
        return "mock-chat-model"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:  # type: ignore[override]
        msg = AIMessage(content=self._response)
        return ChatResult(generations=[ChatGeneration(message=msg)])


def _checker() -> ConsistencyCheckerAgent:
    return ConsistencyCheckerAgent(_MockChatModel('{"issues": [], "has_issues": false, "summary": null}'))


def test_consistency_format_output_accepts_unquoted_keys() -> None:
    agent = _checker()
    raw = "{issues: [], has_issues: false, summary: null}"

    result = agent.format_output(raw)

    assert isinstance(result, ScriptConsistencyCheckResult)
    assert result.has_issues is False
    assert result.issues == []


def test_consistency_format_output_accepts_python_literal_style() -> None:
    agent = _checker()
    raw = "{'issues': [], 'has_issues': False, 'summary': None}"

    result = agent.format_output(raw)

    assert isinstance(result, ScriptConsistencyCheckResult)
    assert result.has_issues is False
    assert result.summary is None


def test_consistency_format_output_accepts_model_call_style() -> None:
    agent = _checker()
    raw = "ScriptConsistencyCheckResult(issues=[], has_issues=False, summary=None)"

    result = agent.format_output(raw)

    assert isinstance(result, ScriptConsistencyCheckResult)
    assert result.has_issues is False
    assert result.issues == []




@pytest.mark.asyncio
@pytest.mark.parametrize("responses", [False, True])
async def test_agent_returns_interleaved_tool_results_to_gateway(monkeypatch, responses) -> None:
    import json

    import httpx
    from langchain.agents import create_agent

    from app.models.llm import Model, ModelCategoryKey, Provider
    from app.services.llm.resolver import build_provider_agent_model

    requests = []

    def lookup(record: str) -> str:
        """Return the requested record."""
        return f"found {record}"

    def tool(index: int, arguments: str, call_id: str | None = None) -> dict:
        chunk = {"index": index, "function": {"arguments": arguments}}
        if call_id is not None:
            chunk.update(id=call_id, type="function")
            chunk["function"]["name"] = "lookup"
        return chunk

    def reply(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        requests.append(payload)
        if responses:
            assert request.url.path.endswith("/responses")
            events = []
            if len(requests) == 1:
                for index, call_id in enumerate(("call-a", "call-b")):
                    events.append({"type": "response.output_item.added", "output_index": index,
                                   "item": {"type": "function_call", "name": "lookup", "call_id": call_id}})
                for index, delta in ((1, '{"record":"be'), (0, '{"record":"al'), (0, 'pha"}'), (1, 'ta"}')):
                    events.append({"type": "response.function_call_arguments.delta", "output_index": index, "delta": delta})
            else:
                events.append({"type": "response.output_text.delta", "delta": "两个记录已找到"})
            events.append({"type": "response.completed", "response": {"id": "resp_test", "status": "completed"}})
            return httpx.Response(200, headers={"Content-Type": "text/event-stream"},
                                  text="".join("data: " + json.dumps(event) + "\n\n" for event in events))
        if len(requests) == 1:
            parts = [
                ({"tool_calls": [tool(0, '{"record":"al', "call-a")]}, None),
                ({"tool_calls": [tool(1, '{"record":"be', "call-b")]}, None),
                ({"tool_calls": [tool(0, 'pha"}'), tool(1, 'ta"}')]}, "tool_calls"),
            ]
        else:
            parts = [({"content": "两个记录已找到"}, "stop")]
        data = [
            "data: " + json.dumps({"choices": [{"index": 0, "delta": delta, "finish_reason": finish}]})
            for delta, finish in parts
        ]
        return httpx.Response(200, headers={"Content-Type": "text/event-stream"},
                              text="\n\n".join([*data, "data: [DONE]", ""]))

    original_init = httpx.AsyncClient.__init__
    transport = httpx.MockTransport(reply)

    def init_client(self, *args, **kwargs):
        kwargs.setdefault("transport", transport)
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", init_client)
    provider = Provider(id="test", name="Test", provider_key="openai", api_key="test-key")
    model = Model(id="test-chat", name="test-chat", category=ModelCategoryKey.text,
                 provider_id=provider.id, params={"streaming": True, "use_responses_api": responses, **({"use_previous_response_id": True} if responses else {})},
                 capability_profile={"tool_calling": {"declaration": "supported"}})
    agent = create_agent(build_provider_agent_model(provider=provider, model=model, thinking=True), tools=[lookup])
    output = await agent.ainvoke({"messages": [{"role": "user", "content": "查询两个记录"}]})

    assert output["messages"][-1].content == "两个记录已找到"
    assert len(requests) == 2
    if responses:
        assert requests[1]["previous_response_id"] == "resp_test"
        assert all(item["type"] == "function_call_output" for item in requests[1]["input"])
        assert requests[0]["tools"][0]["name"] == "lookup"
        assert {item["call_id"]: item["output"] for item in requests[1]["input"]
                if item.get("type") == "function_call_output"} == {"call-a": "found alpha", "call-b": "found beta"}
        return
    assert requests[0]["tools"][0]["function"]["name"] == "lookup"
    assert {message["tool_call_id"]: message["content"] for message in requests[1]["messages"]
            if message["role"] == "tool"} == {"call-a": "found alpha", "call-b": "found beta"}


@pytest.mark.asyncio
async def test_langchain_adapter_requests_native_json_schema(monkeypatch) -> None:
    import json

    import httpx
    from pydantic import BaseModel

    from app.models.llm import Model, ModelCategoryKey, Provider
    from app.services.llm.resolver import build_provider_agent_model

    class Answer(BaseModel):
        approved: bool

    def reply(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        response_format = payload["response_format"]
        assert response_format["type"] == "json_schema"
        assert response_format["json_schema"]["name"] == "Answer"
        assert response_format["json_schema"]["schema"]["properties"]["approved"]["type"] == "boolean"
        return httpx.Response(200, json={"choices": [{
            "index": 0, "message": {"content": '{"approved":true}'}, "finish_reason": "stop",
        }]})

    original_init = httpx.AsyncClient.__init__
    transport = httpx.MockTransport(reply)

    def init_client(self, *args, **kwargs):
        kwargs.setdefault("transport", transport)
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", init_client)
    provider = Provider(id="test", name="Test", provider_key="openai", api_key="test-key")
    model = Model(id="test-chat", name="test-chat", category=ModelCategoryKey.text, provider_id=provider.id)
    adapter = build_provider_agent_model(provider=provider, model=model, thinking=True)
    result = await adapter.with_structured_output(Answer, method="json_schema", include_raw=True).ainvoke("批准")
    assert result["parsed"] == Answer(approved=True)
    assert result["parsing_error"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_responses_agent_preserves_finish_reason_and_retries_before_output(stream):
    import json
    import httpx
    from langchain_core.messages import AIMessage, HumanMessage
    from app.models.llm import Model, ModelCategoryKey, Provider
    from app.services.llm.resolver import build_provider_agent_model

    requests = []

    def reply(request):
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(429)
        response = {"status": "incomplete", "incomplete_details": {"reason": "content_filter"}, "output": []}
        if not stream:
            return httpx.Response(200, json=response)
        data = json.dumps({"type": "response.incomplete", "response": response})
        return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, text=f"data: {data}\n\n")

    provider = Provider(id="p", name="gateway", provider_key="openai", api_key="fixture")
    model = Model(name="test", category=ModelCategoryKey.text, provider_id="p",
                  params={"use_responses_api": True, "use_previous_response_id": True, "max_retries": 1})
    async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
        agent = build_provider_agent_model(provider=provider, model=model, thinking=True,
                                           configure=lambda params: params.update(http_async_client=client))
        history = [AIMessage(content="prior", response_metadata={"id": "chatcmpl-other"}), HumanMessage("continue")]
        if stream:
            chunks = [chunk async for chunk in agent.astream(history)]
            assert any(chunk.response_metadata.get("finish_reason") == "content_filter" for chunk in chunks)
        else:
            assert (await agent.ainvoke(history)).response_metadata["finish_reason"] == "content_filter"
    assert len(requests) == 2 and requests[0] == requests[1]
    assert "previous_response_id" not in requests[1]
    assert [message["content"] for message in requests[1]["input"]] == ["prior", "continue"]
