"""LLM 供应商选择逻辑的单元测试：OpenAI / MiniMax 自动检测与手动选择。"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from app.config import Settings
from app.dependencies import _resolve_llm_provider, get_llm


class TestResolveLlmProvider:
    """测试 _resolve_llm_provider() 供应商检测逻辑。"""

    def test_explicit_provider_takes_priority(self) -> None:
        with patch("app.dependencies.settings", Settings(llm_provider="minimax", openai_api_key="sk-xxx")):
            assert _resolve_llm_provider() == "minimax"

    def test_explicit_provider_case_insensitive(self) -> None:
        with patch("app.dependencies.settings", Settings(llm_provider="MiniMax", minimax_api_key="mm-xxx")):
            assert _resolve_llm_provider() == "minimax"

    def test_auto_detect_openai(self) -> None:
        with patch("app.dependencies.settings", Settings(openai_api_key="sk-xxx")):
            assert _resolve_llm_provider() == "openai"

    def test_auto_detect_minimax(self) -> None:
        with patch("app.dependencies.settings", Settings(minimax_api_key="mm-xxx")):
            assert _resolve_llm_provider() == "minimax"

    def test_openai_takes_priority_over_minimax(self) -> None:
        with patch("app.dependencies.settings", Settings(openai_api_key="sk-xxx", minimax_api_key="mm-xxx")):
            assert _resolve_llm_provider() == "openai"

    def test_no_provider_returns_empty(self) -> None:
        with patch.dict(os.environ, {}, clear=True), \
             patch("app.dependencies.settings", Settings(_env_file=None)):
            assert _resolve_llm_provider() == ""


class TestGetLlmOpenAI:
    """测试 get_llm() 使用 OpenAI 配置。"""

    @patch("app.dependencies.settings", Settings(openai_api_key="sk-test", openai_model="gpt-4o"))
    def test_openai_returns_chat_instance(self) -> None:
        llm = get_llm()
        assert llm.model_name == "gpt-4o"
        assert llm.temperature == 0

    @patch("app.dependencies.settings", Settings(
        openai_api_key="sk-test",
        openai_base_url="https://custom.example.com/v1",
        openai_model="gpt-4o-mini",
    ))
    def test_openai_custom_base_url(self) -> None:
        llm = get_llm()
        assert llm.model_name == "gpt-4o-mini"
        assert "custom.example.com" in str(llm.openai_api_base)


class TestGetLlmMiniMax:
    """测试 get_llm() 使用 MiniMax 配置。"""

    @patch("app.dependencies.settings", Settings(minimax_api_key="mm-test"))
    def test_minimax_returns_chat_instance(self) -> None:
        llm = get_llm()
        assert llm.model_name == "MiniMax-M2.5"
        assert llm.temperature == 0
        assert "minimax" in str(llm.openai_api_base)

    @patch("app.dependencies.settings", Settings(minimax_api_key="mm-test", minimax_model="MiniMax-M2.7"))
    def test_minimax_custom_model(self) -> None:
        llm = get_llm()
        assert llm.model_name == "MiniMax-M2.7"

    @patch("app.dependencies.settings", Settings(
        minimax_api_key="mm-test",
        minimax_base_url="https://custom-minimax.example.com/v1",
    ))
    def test_minimax_custom_base_url(self) -> None:
        llm = get_llm()
        assert "custom-minimax" in str(llm.openai_api_base)

    @patch("app.dependencies.settings", Settings(
        llm_provider="minimax",
        minimax_api_key="mm-test",
    ))
    def test_minimax_explicit_provider(self) -> None:
        llm = get_llm()
        assert llm.model_name == "MiniMax-M2.5"
        assert "minimax" in str(llm.openai_api_base)


class TestGetLlmErrors:
    """测试 get_llm() 错误处理。"""

    def test_no_key_raises_503(self) -> None:
        from fastapi import HTTPException
        with patch.dict(os.environ, {}, clear=True), \
             patch("app.dependencies.settings", Settings(_env_file=None)):
            with pytest.raises(HTTPException) as exc_info:
                get_llm()
            assert exc_info.value.status_code == 503
            assert "No LLM provider configured" in exc_info.value.detail

    @patch("app.dependencies.settings", Settings(
        llm_provider="minimax",
        openai_api_key="sk-xxx",
    ))
    def test_explicit_minimax_without_minimax_key_still_works_if_openai_key_set(self) -> None:
        """LLM_PROVIDER=minimax 但只设了 OPENAI_API_KEY — 仍选 minimax，api_key 为 None。"""
        llm = get_llm()
        assert llm.model_name == "MiniMax-M2.5"


class TestConfigSettings:
    """测试 Settings 中 MiniMax 相关字段默认值。"""

    def test_default_minimax_base_url(self) -> None:
        s = Settings()
        assert s.minimax_base_url == "https://api.minimax.io/v1"

    def test_default_minimax_model(self) -> None:
        s = Settings()
        assert s.minimax_model == "MiniMax-M2.5"

    def test_default_llm_provider_is_none(self) -> None:
        s = Settings()
        assert s.llm_provider is None

    def test_minimax_key_from_env(self) -> None:
        with patch.dict(os.environ, {"MINIMAX_API_KEY": "env-mm-key"}):
            s = Settings()
            assert s.minimax_api_key == "env-mm-key"


# ---------- MiniMax 真实 API 集成测试 ----------


@pytest.mark.integration
@pytest.mark.skipif(
    not os.environ.get("MINIMAX_API_KEY"),
    reason="MINIMAX_API_KEY not set; skip MiniMax integration",
)
class TestMiniMaxIntegration:
    """使用真实 MiniMax API 的集成测试；未设置 MINIMAX_API_KEY 时跳过。"""

    def test_minimax_chat_completion(self) -> None:
        from langchain_openai import ChatOpenAI

        llm = ChatOpenAI(
            model=os.environ.get("MINIMAX_MODEL", "MiniMax-M2.5"),
            temperature=0,
            api_key=os.environ["MINIMAX_API_KEY"],
            base_url=os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
        )
        result = llm.invoke("Say 'hello' in one word.")
        assert result.content
        assert len(str(result.content)) > 0

    def test_minimax_get_llm_dependency(self) -> None:
        with patch("app.dependencies.settings", Settings(
            minimax_api_key=os.environ["MINIMAX_API_KEY"],
            minimax_model=os.environ.get("MINIMAX_MODEL", "MiniMax-M2.5"),
        )):
            llm = get_llm()
            result = llm.invoke("What is 1+1? Answer with just the number.")
            assert "2" in str(result.content)
