"""场景信息缺失分析 Agent：SceneInfoAnalysisAgent"""

from __future__ import annotations

from typing import Any

from langchain_core.prompts import PromptTemplate

from app.chains.agents.base import AgentBase
from app.schemas.skills.scene_info_analysis import SceneInfoAnalysisResult

_SCENE_INFO_SYSTEM_PROMPT = """\
You are a scene information analyst. Given an original scene description, identify the key missing or ambiguous information that would prevent a reliable scene concept or scene asset image from being generated: spatial structure, time and weather, lighting and atmosphere, materials and style, key furnishings or landmarks, visible range, depth of field, and composition.

Output language requirement:
- Write every user-visible value in English, including every string inside issues and optimized_description.
- Preserve proper nouns and names from the source text, but translate descriptive content into natural English.

Requirements:
- The output must strictly serve AI image generation. optimized_description must be a coherent, positive, visually rich paragraph.
- Use the source only as reference: preserve every explicit scene fact from the source, including location, interior/exterior status, time, event state, characters, and key objects. You may smooth wording and reorder information, but you must not change, replace, or weaken explicit facts.
- When the source is incomplete, make conservative, visually useful additions so optimized_description covers: scene type and purpose, spatial layout and scale, interior/exterior and time of day, weather or environmental state when relevant, light direction and quality, color palette and atmosphere, materials and period/style, key furnishings or landmarks, floor and wall details, visible environmental traces such as dust, dampness, damage, or clutter, and the visual focus or compositional center.
- issues: list the truly missing key dimensions or ambiguities, and explain how each gap affects scene consistency, spatial readability, or atmospheric accuracy.
- optimized_description: retain all explicit source information and complete missing areas with concrete affirmative language, forming a paragraph that can be copied directly into an AI image-generation model.

Strict prohibitions:
- optimized_description must never contain vague placeholders or uncertainty such as "not specified", "unknown", "unclear", "not detailed", "not mentioned", "assume", "for example", "could be imagined", "similar to", "usually", "maybe", "probably", or equivalent wording in any language.
- All descriptions must be affirmative, specific, and directly visualizable.
- issues may discuss missing or ambiguous information; optimized_description must not repeat that something is missing.
- If the source is already complete, issues may be empty or minimal, while optimized_description should still be structured and fluent without adding unsupported key facts.

Output only JSON that matches the SceneInfoAnalysisResult schema.
"""

SCENE_INFO_PROMPT = PromptTemplate(
    input_variables=["scene_context", "scene_description"],
    template=(
        "## Original scene context (optional)\n{scene_context}\n\n"
        "## Original scene description\n{scene_description}\n\n"
        "## Output\n"
    ),
)


class SceneInfoAnalysisAgent(AgentBase[SceneInfoAnalysisResult]):
    """根据原文场景描述分析缺失信息，并输出优化后的可生成场景描述。"""

    @property
    def system_prompt(self) -> str:
        return _SCENE_INFO_SYSTEM_PROMPT

    @property
    def prompt_template(self) -> PromptTemplate:
        return SCENE_INFO_PROMPT

    @property
    def output_model(self) -> type[SceneInfoAnalysisResult]:
        return SceneInfoAnalysisResult

    def analyze_scene_description(
        self, *, scene_description: str, scene_context: str | None = None
    ) -> SceneInfoAnalysisResult:
        return self.extract(
            scene_context=scene_context or "",
            scene_description=scene_description,
        )

    async def a_analyze_scene_description(
        self, *, scene_description: str, scene_context: str | None = None
    ) -> SceneInfoAnalysisResult:
        return await self.aextract(
            scene_context=scene_context or "",
            scene_description=scene_description,
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
