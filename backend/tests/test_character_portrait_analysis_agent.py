"""资产整理的结构化候选与证据验证回归。"""

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import ValidationError

from app.chains.agents import CharacterPortraitAnalysisAgent
from app.core.contracts.asset_analysis import CharacterPortraitAnalysisResult


class _MockChatModel(BaseChatModel):
    """返回固定候选，测试不调用外部模型。"""

    def __init__(self, response: str) -> None:
        """保存用于解析与证据校验的响应。"""
        super().__init__()
        self._response = response

    @property
    def _llm_type(self) -> str:
        """标识隔离测试模型。"""
        return "mock-chat-model"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        """输出固定 JSON，覆盖真实 Agent 格式化路径。"""
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=self._response))])


def test_candidate_parser_preserves_uncertainty_and_evidence():
    """年龄范围不能被强行变成精确数字，明确值保留证据。"""
    raw = "{'issues': ['肤色未说明'], 'suggestions': [{'field': 'age_appearance', 'value': '约30岁', 'source': 'explicit', 'evidence': '约30岁'}]}"
    agent = CharacterPortraitAnalysisAgent(_MockChatModel(raw))
    result = agent.analyze_character_description(character_description="一个约30岁的人")
    assert result.suggestions[0].value == "约30岁"
    assert result.suggestions[0].source == "explicit"


def test_inference_is_labeled_and_not_merged_into_description():
    """推断保持为候选，不再输出可直接覆盖整段设定的描述。"""
    result = CharacterPortraitAnalysisResult.model_validate({
        "suggestions": [{"field": "hair", "value": "黑色短发", "source": "inferred"}],
    })
    assert result.suggestions[0].source == "inferred"
    assert "optimized_description" not in result.model_dump()


def test_invalid_field_missing_or_fabricated_evidence_is_rejected():
    """跨类别字段、空依据和捏造引文不能成为明确事实。"""
    with pytest.raises(ValidationError):
        CharacterPortraitAnalysisResult(suggestions=[{"field": "materials", "value": "木质", "source": "inferred"}])
    with pytest.raises(ValidationError):
        CharacterPortraitAnalysisResult(suggestions=[{"field": "hair", "value": "黑发", "source": "explicit"}])
    raw = '{"suggestions": [{"field": "hair", "value": "黑发", "source": "explicit", "evidence": "原文没有这个"}]}'
    with pytest.raises(ValueError, match="不在输入原文"):
        CharacterPortraitAnalysisAgent(_MockChatModel(raw)).analyze_character_description(character_description="一位青年")
