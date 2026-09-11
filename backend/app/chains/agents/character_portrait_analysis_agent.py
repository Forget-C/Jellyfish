"""人物画像缺失信息分析 Agent：CharacterPortraitAnalysisAgent"""

from __future__ import annotations

from langchain_core.prompts import PromptTemplate

from app.chains.agents.base import AgentBase
from app.core.contracts.asset_analysis import CharacterPortraitAnalysisResult

_CHARACTER_PORTRAIT_SYSTEM_PROMPT = """你是资产设定整理助手。根据当前Actor的原文描述和上下文，提出可核对的分类字段建议。
允许的字段：age_appearance（外观年龄）、gender（性别设定）、build（体型）、facial_features（五官特征）、skin_tone（肤色）、hair（发型发色）、supplementary_info（补充信息）。
只输出 JSON：issues 为缺失或冲突说明；suggestions 为字段候选数组，每项包含 field、value、source、evidence。
规则：
- 只整理与当前资产相关的长期视觉设定，不把镜头动作、灯光、临时天气或构图写入主体。
- 原文明示内容使用 source="explicit"，evidence 必须逐字引用输入中的对应片段。
- 不确定内容可以只列 issues 并不提供候选。若提出推断选项，必须使用 source="inferred"，不能冒充明确事实。
- 完整保留年龄范围、否定要求和显著特征，不用肯定语气掩盖未知值。
- 同一字段最多一个候选；补充信息仅保留固定字段无法表达的原有要求，不重复拼装全部字段。
- 演员只包含身份外观；正式服装、道具属于独立资产与角色组合，不为演员凭空补全衣着、性格或背景故事。
- 已给定的设定不得改写；互相矛盾的输入在 issues 中指出并等待用户确认。
结果仅供用户比较和采用，不直接覆盖资产。
"""

CHARACTER_PORTRAIT_PROMPT = PromptTemplate(
    input_variables=["character_context", "character_description"],
    template=(
        "## 原文人物上下文（可为空）\n{character_context}\n\n"
        "## 原文人物描述\n{character_description}\n\n"
        "## 输出\n"
    ),
)


class CharacterPortraitAnalysisAgent(AgentBase[CharacterPortraitAnalysisResult]):
    """根据原文人物描述分析缺失信息，并输出待确认的分类字段建议。"""

    @property
    def system_prompt(self) -> str:
        """返回分类事实与推断分离的整理规则。"""
        return _CHARACTER_PORTRAIT_SYSTEM_PROMPT

    @property
    def prompt_template(self) -> PromptTemplate:
        """只传入当前资产文本与上下文。"""
        return CHARACTER_PORTRAIT_PROMPT

    @property
    def output_model(self) -> type[CharacterPortraitAnalysisResult]:
        """约束候选字段、证据与长度。"""
        return CharacterPortraitAnalysisResult

    def analyze_character_description(
        self, *, character_description: str, character_context: str | None = None
    ) -> CharacterPortraitAnalysisResult:
        """生成结构化建议并核对明确事实的原文依据。"""
        result = self.extract(
            character_context=character_context or "",
            character_description=character_description,
        )
        return result.verify_evidence(character_description + "\n" + (character_context or ""))

    async def a_analyze_character_description(
        self, *, character_description: str, character_context: str | None = None
    ) -> CharacterPortraitAnalysisResult:
        """异步生成结构化建议，核对证据后返回待确认结果。"""
        result = await self.aextract(
            character_context=character_context or "",
            character_description=character_description,
        )
        return result.verify_evidence(character_description + "\n" + (character_context or ""))
