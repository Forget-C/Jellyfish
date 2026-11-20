"""剧本优化 Agent：ScriptOptimizerAgent"""

from __future__ import annotations

from typing import Any

from langchain_core.prompts import PromptTemplate

from app.chains.agents.base import AgentBase
from app.schemas.skills.script_processing import ScriptOptimizationResult

_SCRIPT_OPTIMIZER_SYSTEM_PROMPT = """\
你是\"剧本优化师\"。仅修复用户选中并确认为异常的问题（resolution=repair）。遵守用户处理意见，保留未选问题、无关段落及正常留白。只修改各问题 excerpt 所覆盖的原文，返回完整合并稿，不新增剧情或拍摄安排。

输入：
- script_text：原文
- consistency_json：一致性检查输出（ScriptConsistencyCheckResult）

输出 ScriptOptimizationResult：
- optimized_script_text：优化后的完整剧本文本（尽量少改，只改与 issues 相关的段落）
- change_summary：逐条对应 issues 的改动摘要

只输出 JSON。
"""

SCRIPT_OPTIMIZER_PROMPT = PromptTemplate(
    input_variables=["script_text", "consistency_json", "explanations"],
    template="## 一致性检查结果\n{consistency_json}\n\n## 原文剧本\n{script_text}\n\n## 已确认原意解释\n{explanations}\n\n## 输出\n",
).partial(explanations="[]")


class ScriptOptimizerAgent(AgentBase[ScriptOptimizationResult]):
    """剧本优化 Agent：输入一致性检查输出 + 原文，输出优化后的剧本。"""

    @property
    def system_prompt(self) -> str:
        return _SCRIPT_OPTIMIZER_SYSTEM_PROMPT

    @property
    def prompt_template(self) -> PromptTemplate:
        return SCRIPT_OPTIMIZER_PROMPT

    @property
    def output_model(self) -> type[ScriptOptimizationResult]:
        return ScriptOptimizationResult

    def _normalize(self, data: dict[str, Any]) -> dict[str, Any]:
        data = dict(data)
        if "optimized_script_text" not in data:
            data["optimized_script_text"] = ""
        if "change_summary" not in data:
            data["change_summary"] = ""
        return data

