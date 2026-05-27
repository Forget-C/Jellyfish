"""道具信息缺失分析 Agent：PropInfoAnalysisAgent"""

from __future__ import annotations

from typing import Any

from langchain_core.prompts import PromptTemplate

from app.chains.agents.base import AgentBase
from app.schemas.skills.prop_info_analysis import PropInfoAnalysisResult

_PROP_INFO_SYSTEM_PROMPT = """\
You are a prop information analyst. Given an original prop description, identify the key missing or ambiguous information that would prevent a reliable prop asset image from being generated: external structure, materials and craft, size and proportions, usage, condition details, period and style, labels, wear, and distinctive marks.

Output language requirement:
- Write every user-visible value in English, including every string inside issues and optimized_description.
- Preserve proper nouns and names from the source text, but translate descriptive content into natural English.

Requirements:
- The output must strictly serve AI image generation. optimized_description must be a coherent, positive, visually rich paragraph.
- Use the source only as reference: preserve every explicit prop fact from the source, including name, function, ownership, period/style, material, and condition. You may smooth wording and reorder information, but you must not change, replace, or weaken explicit facts.
- When the source is incomplete, make conservative, visually useful additions so optimized_description covers: prop name and type, overall form and structure, materials and surface texture, colors and key details, size and proportions, usage and functional traits, condition such as newness, wear, stains, damage, or moving parts, identifying marks or unique features, and optional story-consistent environmental traces.
- issues: list the truly missing key dimensions or ambiguities, and explain how each gap affects prop consistency, structural readability, or detail completeness.
- optimized_description: retain all explicit source information and complete missing areas with concrete affirmative language, forming a paragraph that can be copied directly into an AI image-generation model.

Strict prohibitions:
- optimized_description must never contain vague placeholders or uncertainty such as "not specified", "unknown", "unclear", "not detailed", "not mentioned", "assume", "for example", "could be imagined", "similar to", "usually", "maybe", "probably", or equivalent wording in any language.
- All descriptions must be affirmative, specific, and directly visualizable.
- issues may discuss missing or ambiguous information; optimized_description must not repeat that something is missing.
- If the source is already complete, issues may be empty or minimal, while optimized_description should still be structured and fluent without adding unsupported key facts.

Output only JSON that matches the PropInfoAnalysisResult schema.
"""

PROP_INFO_PROMPT = PromptTemplate(
    input_variables=["prop_context", "prop_description"],
    template=(
        "## Original prop context (optional)\n{prop_context}\n\n"
        "## Original prop description\n{prop_description}\n\n"
        "## Output\n"
    ),
)


class PropInfoAnalysisAgent(AgentBase[PropInfoAnalysisResult]):
    """根据原文道具描述分析缺失信息，并输出优化后的可生成道具描述。"""

    @property
    def system_prompt(self) -> str:
        return _PROP_INFO_SYSTEM_PROMPT

    @property
    def prompt_template(self) -> PromptTemplate:
        return PROP_INFO_PROMPT

    @property
    def output_model(self) -> type[PropInfoAnalysisResult]:
        return PropInfoAnalysisResult

    def analyze_prop_description(
        self, *, prop_description: str, prop_context: str | None = None
    ) -> PropInfoAnalysisResult:
        return self.extract(
            prop_context=prop_context or "",
            prop_description=prop_description,
        )

    async def a_analyze_prop_description(
        self, *, prop_description: str, prop_context: str | None = None
    ) -> PropInfoAnalysisResult:
        return await self.aextract(
            prop_context=prop_context or "",
            prop_description=prop_description,
        )

    def _normalize(self, data: dict[str, Any]) -> dict[str, Any]:
        # 宽松兼容：issues/optimized_description 字段类型兜底，避免 strict schema 校验失败
        data = dict(data)
        issues = data.get("issues", [])
        if not isinstance(issues, list):
            data["issues"] = [str(issues)] if issues is not None else []
        if "optimized_description" not in data:
            data["optimized_description"] = ""

        # 兜底清理：若模型把“信息不详/未知”等占位句写进 optimized_description，则移除这些句子
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
                data["optimized_description"] = cleaned or optimized

        return data
