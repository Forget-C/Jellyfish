"""一致性检查 Agent：ConsistencyCheckerAgent"""

from __future__ import annotations

from typing import Any

from langchain_core.prompts import PromptTemplate

from app.chains.agents.base import AgentBase
from app.schemas.skills.script_processing import ScriptConsistencyCheckResult

_CONSISTENCY_CHECKER_SYSTEM_PROMPT = """\
你是章节文字表达检查员。只检查文字表达与原意解释，不检查具体拍摄安排。
检查 language：错别字、影响理解的标点、语法搭配、成分缺失、语序；semantics：语义不通及上下文表达矛盾。
身份指代、空间、动作时间、道具和事实仅检查原文明示内容的歧义或冲突。
结合上下文保留有意的口语、方言、省略、重复和文学留白；不做一般润色，不默认改变文风。
例如“李成才从另一侧车门下来并打招呼”表达成立；没有绕车路线、停位、机位或遮挡安排不构成章节问题。
上下文已明确李哥是谁时不要重复报错。不能从本章得到的身份、背景和意图应提问，由用户补充确认，不编造候选。
用户允许有意不说明时保留不确定性，不要求填满留白。
同时检查补充解释：是否与正文冲突、编造未经确认背景、混入为拍摄新增的路线或站位。
空间描述本身不是越界证据，必须区分澄清原意与选择拍摄实现。不判断拍摄方案是否合理，不把解释内容改写进正文。
explanations 中包含待复核及旧正文解释；旧正文的解释不可当作当前正文事实，必要时仅提示重新核对。
正文问题 target=source；解释问题 target=explanation，explanation_id 必须为输入中真实条目ID。
AI 只提供疑点和建议，不自动作废解释。kind=normal 是用户的正常表达确认，依据未变时不要反复报同一问题。
每项给出 issue_type、classification（contradiction 明确矛盾、ambiguity 待确认歧义、optional 可选补充）、
逐字且有足够上下文唯一定位的 excerpt、description、suggestion；候选只列有依据的解释，不凑数。

输出 ScriptConsistencyCheckResult：
- issues: 每条问题必须包含 character_candidates、description、suggestion；尽量给出 affected_lines（start_line/end_line）。
- has_issues: issues 非空则为 true

只输出 JSON。
"""

CONSISTENCY_CHECKER_PROMPT = PromptTemplate(
    input_variables=["script_text", "explanations"],
    template="## 原文剧本\n{script_text}\n\n## 补充解释（含待复核条目）\n{explanations}\n\n## 输出\n",
).partial(explanations="[]")


class ConsistencyCheckerAgent(AgentBase[ScriptConsistencyCheckResult]):
    """检查章节文字表达和补充解释的适用性，提出疑点与建议。"""

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
        """规范化章节文字检查结果。"""
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

