"""一致性检查 Agent：ConsistencyCheckerAgent"""

from __future__ import annotations

from typing import Any

from langchain_core.prompts import PromptTemplate

from app.chains.agents.base import AgentBase
from app.schemas.skills.script_processing import ScriptConsistencyCheckResult

_CONSISTENCY_CHECKER_SYSTEM_PROMPT = """\
你是原文一致性检查员。检查身份与指代、空间关系、动作与时间、道具状态、原文事实五类一致性。
正常称呼（如多人都可能被叫李哥）、文学留白、未写精确站位或焦段不直接构成错误。
人物出画不等于离场，切镜不改变场内状态；不要要求原文逐镜重复交代在场人物。
每项给出 issue_type、classification（contradiction 明确矛盾、ambiguity 待确认歧义、optional 可选补充）、
逐字且可定位的 excerpt、description、suggestion；有多种可靠解释时给 candidates，不凑选项。
先判断表述是否成立，不把模型可能误解等同于原文错误。只检查本章，不推断其他章节或资产设定。
补充解释是经用户确认的原意说明，不是原文摘录，不能用于新增剧情或覆盖正文冲突。

输出 ScriptConsistencyCheckResult：
- issues: 每条问题必须包含 character_candidates、description、suggestion；尽量给出 affected_lines（start_line/end_line）。
- has_issues: issues 非空则为 true

只输出 JSON。
"""

CONSISTENCY_CHECKER_PROMPT = PromptTemplate(
    input_variables=["script_text", "explanations"],
    template="## 原文剧本\n{script_text}\n\n## 已确认补充解释\n{explanations}\n\n## 输出\n",
).partial(explanations="[]")


class ConsistencyCheckerAgent(AgentBase[ScriptConsistencyCheckResult]):
    """一致性检查（角色混淆）：输入原文，检测同一角色身份/行为混淆并给出修改建议。"""

    @property
    def system_prompt(self) -> str:
        return _CONSISTENCY_CHECKER_SYSTEM_PROMPT

    @property
    def prompt_template(self) -> PromptTemplate:
        return CONSISTENCY_CHECKER_PROMPT

    @property
    def output_model(self) -> type[ScriptConsistencyCheckResult]:
        return ScriptConsistencyCheckResult

    def _normalize(self, data: dict[str, Any]) -> dict[str, Any]:
        """规范化一致性检查结果（角色混淆）。"""
        data = dict(data)
        if "issues" not in data or not isinstance(data["issues"], list):
            data["issues"] = []
        for it in data["issues"]:
            if isinstance(it, dict):
                it.setdefault("issue_type", "character_confusion")
                it.setdefault("character_candidates", [])
                it.setdefault("affected_lines", None)
                it.setdefault("evidence", [])
        if "has_issues" not in data:
            data["has_issues"] = len(data["issues"]) > 0
        if "summary" not in data:
            data["summary"] = None
        return data

