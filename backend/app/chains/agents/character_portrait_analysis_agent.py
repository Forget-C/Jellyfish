"""人物画像缺失信息分析 Agent：CharacterPortraitAnalysisAgent"""

from __future__ import annotations

from typing import Any

from langchain_core.prompts import PromptTemplate

from app.chains.agents.base import AgentBase
from app.schemas.skills.character_portrait import CharacterPortraitAnalysisResult

_CHARACTER_PORTRAIT_SYSTEM_PROMPT = """\
You are a character portrait analyst. Given an original character description, identify the key missing or ambiguous information that would prevent a reliable character portrait from being generated: appearance, costume styling, temperament, personality tendency, perceived age, distinctive marks, and background or motivation cues.

Output language requirement:
- Write every user-visible value in English, including every string inside issues and optimized_description.
- Preserve proper nouns and names from the source text, but translate descriptive content into natural English.

Requirements:
- The output must strictly serve AI image generation. optimized_description must be a coherent, positive, visually rich paragraph.
- Use the source only as reference: preserve every explicit character fact from the source, including age, gender, appearance, and personality. You may smooth wording and reorder information, but you must not change, replace, or weaken explicit facts.
- When the source is incomplete, make conservative, visually useful additions so optimized_description covers: age, gender, personality tendency, facial features, body shape, skin quality, hairstyle, clothing/styling, temperament, distinctive features, and optional background or motivation cues consistent with the portrait goal.
- issues: list the truly missing key dimensions or ambiguities, and explain how each gap affects portrait consistency, visual completeness, recognizability, or character liveliness.
- optimized_description: retain all explicit source information and complete missing areas with concrete affirmative language, forming a paragraph that can be copied directly into an AI image-generation model.

Strict prohibitions:
- optimized_description must never contain vague placeholders or uncertainty such as "not specified", "unknown", "unclear", "not detailed", "not mentioned", "assume", "for example", "could be imagined", "similar to", "usually", "maybe", "probably", or equivalent wording in any language.
- All descriptions must be affirmative, specific, and directly visualizable.
- issues may discuss missing or ambiguous information; optimized_description must not repeat that something is missing.
- If the source is already complete, issues may be empty or minimal, while optimized_description should still be structured and fluent without adding unsupported key facts.

Output only JSON that matches the CharacterPortraitAnalysisResult schema.
"""

CHARACTER_PORTRAIT_PROMPT = PromptTemplate(
    input_variables=["character_context", "character_description"],
    template=(
        "## Original character context (optional)\n{character_context}\n\n"
        "## Original character description\n{character_description}\n\n"
        "## Output\n"
    ),
)


class CharacterPortraitAnalysisAgent(AgentBase[CharacterPortraitAnalysisResult]):
    """根据原文人物描述分析缺失信息，并输出优化后的可生成画像描述。"""

    @property
    def system_prompt(self) -> str:
        return _CHARACTER_PORTRAIT_SYSTEM_PROMPT

    @property
    def prompt_template(self) -> PromptTemplate:
        return CHARACTER_PORTRAIT_PROMPT

    @property
    def output_model(self) -> type[CharacterPortraitAnalysisResult]:
        return CharacterPortraitAnalysisResult

    def analyze_character_description(
        self, *, character_description: str, character_context: str | None = None
    ) -> CharacterPortraitAnalysisResult:
        return self.extract(
            character_context=character_context or "",
            character_description=character_description,
        )

    async def a_analyze_character_description(
        self, *, character_description: str, character_context: str | None = None
    ) -> CharacterPortraitAnalysisResult:
        return await self.aextract(
            character_context=character_context or "",
            character_description=character_description,
        )

    def _normalize(self, data: dict[str, Any]) -> dict[str, Any]:
        # 宽松兼容：issues/optimized_description 字段类型兜底，避免 strict schema 校验失败
        data = dict(data)
        issues = data.get("issues", [])
        if not isinstance(issues, list):
            data["issues"] = [str(issues)] if issues is not None else []
        if "optimized_description" not in data:
            data["optimized_description"] = ""

        # 兜底清理：若模型把“信息不详/未知”等占位句写进 optimized_description，
        # 则移除这些句子，避免影响后续“可生成画像”的正向描述质量。
        optimized = data.get("optimized_description") or ""
        if isinstance(optimized, str) and optimized:
            fuzzy_markers = (
                "信息不详",
                "不详",
                "未知",
                "不明确",
                "未提及",
                "看不出来",
                "无法判断",
                "不确定",
                "暂时无法判断",
            )
            if any(m in optimized for m in fuzzy_markers):
                parts = optimized.replace("\n", " ").split("。")
                kept: list[str] = []
                for p in parts:
                    seg = p.strip()
                    if not seg:
                        continue
                    if any(m in seg for m in fuzzy_markers):
                        continue
                    kept.append(seg)
                cleaned = "。".join(kept).strip()
                # 如果清理后为空，则保留原文（避免误删导致内容全空）
                data["optimized_description"] = cleaned or optimized

        return data

