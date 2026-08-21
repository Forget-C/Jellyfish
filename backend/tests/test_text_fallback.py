"""文本失败回退策略单测。"""

from __future__ import annotations

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableLambda

from app.chains.agents import ConsistencyCheckerAgent
from app.schemas.skills.script_processing import ScriptConsistencyCheckResult
from app.services.llm.text_fallback import (
    FallbackChatModel,
    begin_text_call,
    end_text_call,
    is_fallback_eligible_error,
)


class _MockChatModel(BaseChatModel):
    calls: int = 0

    def __init__(self, response: str = "", error: Exception | None = None) -> None:
        super().__init__()
        self._response = response
        self._error = error
        self.calls = 0

    @property
    def _llm_type(self) -> str:  # pragma: no cover
        return "mock-chat-model"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:  # type: ignore[override]
        self.calls += 1
        if self._error is not None:
            raise self._error
        msg = AIMessage(content=self._response)
        return ChatResult(generations=[ChatGeneration(message=msg)])

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):  # type: ignore[override]
        return RunnableLambda(lambda messages, **_: AIMessage(content=self._response))


def test_is_fallback_eligible_error_classifies_status_and_text() -> None:
    class _StatusError(Exception):
        def __init__(self, status_code: int) -> None:
            super().__init__("api error")
            self.status_code = status_code

    assert is_fallback_eligible_error(_StatusError(500))
    assert is_fallback_eligible_error(_StatusError(429))
    assert not is_fallback_eligible_error(_StatusError(401))
    assert not is_fallback_eligible_error(_StatusError(422))
    assert is_fallback_eligible_error(TimeoutError("request timed out"))
    assert not is_fallback_eligible_error(PermissionError("permission denied"))


def test_fallback_chat_model_escalates_once_then_raises() -> None:
    primary = _MockChatModel(error=TimeoutError("timed out"))
    fallback = _MockChatModel(response="ok")
    model = FallbackChatModel(primary=primary, fallback=fallback)

    begin_text_call()
    try:
        result = model._generate([{"role": "user", "content": "hi"}])
    finally:
        end_text_call()

    assert fallback.calls == 1
    assert result.generations[0].message.content == "ok"

    primary2 = _MockChatModel(error=TimeoutError("timed out"))
    fallback2 = _MockChatModel(error=TimeoutError("timed out"))
    model2 = FallbackChatModel(primary=primary2, fallback=fallback2)

    begin_text_call()
    try:
        with pytest.raises(TimeoutError):
            model2._generate([{"role": "user", "content": "hi"}])
    finally:
        end_text_call()

    assert primary2.calls == 1
    assert fallback2.calls == 1


def test_fallback_chat_model_skips_non_eligible_errors() -> None:
    primary = _MockChatModel(error=ValueError("authentication failed"))
    fallback = _MockChatModel(response="ok")
    model = FallbackChatModel(primary=primary, fallback=fallback)

    begin_text_call()
    try:
        with pytest.raises(ValueError, match="authentication"):
            model._generate([{"role": "user", "content": "hi"}])
    finally:
        end_text_call()

    assert fallback.calls == 0


def test_agent_base_retries_recoverable_failure_with_fallback() -> None:
    agent = ConsistencyCheckerAgent(_MockChatModel())
    agent._fallback_model = _MockChatModel()
    calls = {"count": 0}

    def run() -> ScriptConsistencyCheckResult:
        calls["count"] += 1
        if calls["count"] == 1:
            raise ValueError("Failed to parse LLM output as JSON-like text")
        return ScriptConsistencyCheckResult(issues=[], has_issues=False, summary=None)

    begin_text_call()
    try:
        result = agent._invoke_with_fallback_sync(run)
    finally:
        end_text_call()

    assert calls["count"] == 2
    assert result.has_issues is False


def test_agent_base_does_not_retry_after_fallback_also_fails() -> None:
    agent = ConsistencyCheckerAgent(_MockChatModel())
    agent._fallback_model = _MockChatModel()
    calls = {"count": 0}

    def run() -> ScriptConsistencyCheckResult:
        calls["count"] += 1
        raise ValueError("Failed to parse LLM output as JSON-like text")

    begin_text_call()
    try:
        with pytest.raises(ValueError, match="Failed to parse"):
            agent._invoke_with_fallback_sync(run)
    finally:
        end_text_call()

    assert calls["count"] == 2


def test_fallback_chat_model_bind_tools_returns_invocable_runnable() -> None:
    model = FallbackChatModel(
        primary=_MockChatModel(response="ok"),
        fallback=_MockChatModel(response="ok"),
    )
    bound = model.bind_tools([{"name": "t", "description": "", "parameters": {}}])

    begin_text_call()
    try:
        result = bound.invoke([{"role": "user", "content": "hi"}])
    finally:
        end_text_call()

    assert result is not None
