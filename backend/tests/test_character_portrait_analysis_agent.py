"""CharacterPortraitAnalysisAgent 解析回归测试。"""

from __future__ import annotations

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app.chains.agents import (
    CharacterPortraitAnalysisAgent,
    CostumeInfoAnalysisAgent,
    PropInfoAnalysisAgent,
    SceneInfoAnalysisAgent,
)
from app.schemas.skills.character_portrait import CharacterPortraitAnalysisResult


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


def _contains_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def test_smart_detection_prompts_request_english_user_visible_output() -> None:
    agent_classes = (
        CharacterPortraitAnalysisAgent,
        PropInfoAnalysisAgent,
        SceneInfoAnalysisAgent,
        CostumeInfoAnalysisAgent,
    )

    for agent_class in agent_classes:
        agent = agent_class(_MockChatModel('{"issues": [], "optimized_description": "ok"}'))
        system_prompt = agent.system_prompt
        rendered_prompt = agent.prompt_template.format(**{
            variable: "sample"
            for variable in agent.prompt_template.input_variables
        })

        assert "Write every user-visible value in English" in system_prompt
        assert "Output only JSON" in system_prompt
        assert not _contains_cjk(system_prompt)
        assert not _contains_cjk(rendered_prompt)


def test_character_portrait_format_output_accepts_unquoted_keys() -> None:
    raw = '{issues: [], optimized_description: "一段可生成画像的描述"}'
    agent = CharacterPortraitAnalysisAgent(_MockChatModel(raw))
    result = agent.format_output(raw)

    assert isinstance(result, CharacterPortraitAnalysisResult)
    assert result.issues == []
    assert isinstance(result.optimized_description, str)
    assert "可生成画像的描述" in result.optimized_description


def test_character_portrait_format_output_accepts_python_literal_style() -> None:
    raw = "{'issues': ['缺少外貌细节'], 'optimized_description': '补全后的描述'}"
    agent = CharacterPortraitAnalysisAgent(_MockChatModel(raw))
    result = agent.format_output(raw)

    assert isinstance(result, CharacterPortraitAnalysisResult)
    assert result.issues == ["缺少外貌细节"]
    assert result.optimized_description == "补全后的描述"


def test_character_portrait_removes_fuzzy_placeholder_sentences() -> None:
    raw = (
        "{'issues': ['缺少体态与面部特征'], "
        "'optimized_description': '他看起来很有气质。性格特点以及是否有显著的体态或面部特征等信息不详。衣着风格偏复古。'}"
    )
    agent = CharacterPortraitAnalysisAgent(_MockChatModel(raw))
    result = agent.format_output(raw)

    assert isinstance(result, CharacterPortraitAnalysisResult)
    assert "信息不详" not in result.optimized_description
    assert "复古" in result.optimized_description

