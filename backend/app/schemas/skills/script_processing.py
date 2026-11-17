"""章节原文检查、优化与精简的结构化结果。"""
from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field
from app.schemas.skills.common import EvidenceSpan


class ScriptConsistencyIssue(BaseModel):
    """原文一致性问题；分类是模型初判，由用户确认处理性质。"""

    model_config = ConfigDict(extra="forbid")

    issue_type: Literal["character_confusion", "spatial", "action_time", "prop_state", "fact"] = Field("character_confusion", description="身份指代、空间、动作时间、道具状态或原文事实")
    classification: Literal['contradiction', 'ambiguity', 'optional'] = 'ambiguity'
    excerpt: str = ''
    candidates: list[str] = Field(default_factory=list)
    character_candidates: List[str] = Field(default_factory=list, description="涉及的角色候选（名字/称呼/ID 皆可，优先用原文称呼）")
    description: str = Field(..., description="问题描述（为什么会混淆）")
    suggestion: str = Field(..., description="修改建议（如何改写以消除混淆）")
    affected_lines: Optional[Dict[str, int]] = Field(None, description="受影响的行号范围，形如 {start_line: x, end_line: y}")
    evidence: List[EvidenceSpan] = Field(default_factory=list, description="原文依据（可选）")


class ScriptConsistencyCheckResult(BaseModel):
    """检查结果及固定依据；旧记录默认保持角色混淆范围。"""

    model_config = ConfigDict(extra="forbid")

    issues: List[ScriptConsistencyIssue] = Field(default_factory=list, description="问题列表")
    has_issues: bool = Field(..., description="是否发现问题")
    check_scope: Literal['character_confusion', 'source_consistency'] = 'character_confusion'
    source_version: str | None = None
    explanation_version: str | None = None
    summary: Optional[str] = Field(None, description="总结（可选）")


class ScriptOptimizationResult(BaseModel):
    """剧本优化输出：仅在发现角色混淆问题时使用。"""

    model_config = ConfigDict(extra="forbid")

    source_text: str | None = None
    explanation_version: str | None = None
    optimized_script_text: str = Field(..., description="优化后的剧本文本")
    change_summary: str = Field(..., description="改动摘要（只围绕 issues）")


class ScriptSimplificationResult(BaseModel):
    """剧本精简输出：在保留剧情主体与连续性的前提下压缩篇幅。"""

    model_config = ConfigDict(extra="forbid")

    simplified_script_text: str = Field(..., description="精简后的剧本文本")
    simplification_summary: str = Field(..., description="精简策略摘要（说明删改原则）")
