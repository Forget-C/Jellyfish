"""服装信息缺失分析 Agent：CostumeInfoAnalysisAgent"""

from __future__ import annotations

from typing import Any

from langchain_core.prompts import PromptTemplate

from app.chains.agents.base import AgentBase
from app.schemas.skills.costume_info_analysis import CostumeInfoAnalysisResult

_COSTUME_INFO_SYSTEM_PROMPT = """\
You are a costume information analyst. Given an original costume or styling description, identify the key missing or ambiguous information that would prevent a reliable costume asset image from being generated: cut and construction, layered styling, materials and textures, colors and patterns, accessories and footwear/headwear, period and style, aging, and condition.

Output language requirement:
- Write every user-visible value in English, including every string inside issues and optimized_description.
- Preserve proper nouns and names from the source text, but translate descriptive content into natural English.

Requirements:
- The output must strictly serve AI image generation. optimized_description must be a coherent, positive, visually rich paragraph.
- Use the source only as reference: preserve every explicit costume fact from the source, including garment style, color, material, identity/class cues, and condition. You may smooth wording and reorder information, but you must not change, replace, or weaken explicit facts.
- When the source is incomplete, make conservative, visually useful additions so optimized_description covers: overall styling and period feel, top/bottom/outerwear layers, cut and silhouette, materials and surface texture, primary and secondary colors, patterns and craft details such as stitching, metal hardware, embroidery, buttons, or zippers, accessories such as belts, jewelry, bags, or gloves, footwear and socks, hair ornaments or hats when relevant, and garment condition such as neatness, wrinkles, wear, stains, tears, or dampness.
- issues: list the truly missing key dimensions or ambiguities, and explain how each gap affects costume consistency, layer readability, or style accuracy.
- optimized_description: retain all explicit source information and complete missing areas with concrete affirmative language, forming a paragraph that can be copied directly into an AI image-generation model.

Strict prohibitions:
- optimized_description must never contain vague placeholders or uncertainty such as "not specified", "unknown", "unclear", "not detailed", "not mentioned", "assume", "for example", "could be imagined", "similar to", "usually", "maybe", "probably", or equivalent wording in any language.
- All descriptions must be affirmative, specific, and directly visualizable.
- issues may discuss missing or ambiguous information; optimized_description must not repeat that something is missing.
- If the source is already complete, issues may be empty or minimal, while optimized_description should still be structured and fluent without adding unsupported key facts.

Output only JSON that matches the CostumeInfoAnalysisResult schema.
"""

COSTUME_INFO_PROMPT = PromptTemplate(
    input_variables=["costume_context", "costume_description"],
    template=(
        "## Original costume context (optional)\n{costume_context}\n\n"
        "## Original costume description\n{costume_description}\n\n"
        "## Output\n"
    ),
)


class CostumeInfoAnalysisAgent(AgentBase[CostumeInfoAnalysisResult]):
    """根据原文服装/造型描述分析缺失信息，并输出优化后的可生成服装描述。"""

    @property
    def system_prompt(self) -> str:
        return _COSTUME_INFO_SYSTEM_PROMPT

    @property
    def prompt_template(self) -> PromptTemplate:
        return COSTUME_INFO_PROMPT

    @property
    def output_model(self) -> type[CostumeInfoAnalysisResult]:
        return CostumeInfoAnalysisResult

    def analyze_costume_description(
        self, *, costume_description: str, costume_context: str | None = None
    ) -> CostumeInfoAnalysisResult:
        return self.extract(
            costume_context=costume_context or "",
            costume_description=costume_description,
        )

    async def a_analyze_costume_description(
        self, *, costume_description: str, costume_context: str | None = None
    ) -> CostumeInfoAnalysisResult:
        return await self.aextract(
            costume_context=costume_context or "",
            costume_description=costume_description,
        )

    def _normalize(self, data: dict[str, Any]) -> dict[str, Any]:
        # 宽松兼容：issues/optimized_description 字段类型兜底，避免 strict schema 校验失败
        data = dict(data)
        issues = data.get("issues", [])
        if not isinstance(issues, list):
            data["issues"] = [str(issues)] if issues is not None else []
        if "optimized_description" not in data:
            data["optimized_description"] = ""

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
