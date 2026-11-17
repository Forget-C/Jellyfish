/**
 * 可追溯证据：原文定位（chunk + 起止位置/摘录），用于审核与回查。
 */
export type EvidenceSpan = {
    /**
     * 输入文本块的唯一ID（例如 chapter1_p03）
     */
    chunk_id: string;
    /**
     * 在该 chunk 中的起始字符位置（可选）
     */
    start_char?: (number | null);
    /**
     * 在该 chunk 中的结束字符位置（可选）
     */
    end_char?: (number | null);
    /**
     * 不超过200字的原文摘录（可选，便于人工审核）
     */
    quote?: (string | null);
};

/**
 * 角色混淆类一致性问题：同一角色在不同镜头被赋予不同身份/行为主体导致混淆。
 */
export type ScriptConsistencyIssue = {
    /**
     * 固定为角色混淆类问题
     */
    issue_type?: string;
    classification?: 'contradiction' | 'ambiguity' | 'optional';
    excerpt?: string;
    candidates?: string[];
    /**
     * 涉及的角色候选（名字/称呼/ID 皆可，优先用原文称呼）
     */
    character_candidates?: Array<string>;
    /**
     * 问题描述（为什么会混淆）
     */
    description: string;
    /**
     * 修改建议（如何改写以消除混淆）
     */
    suggestion: string;
    /**
     * 受影响的行号范围，形如 {start_line: x, end_line: y}
     */
    affected_lines?: (Record<string, number> | null);
    /**
     * 原文依据（可选）
     */
    evidence?: Array<EvidenceSpan>;
};

/**
 * 基于原文的一致性检查结果（聚焦角色混淆）。
 */
export type ScriptConsistencyCheckResult = {
    /**
     * 问题列表
     */
    issues?: Array<ScriptConsistencyIssue>;
    /**
     * 是否发现问题
     */
    has_issues: boolean;
    check_scope?: 'character_confusion' | 'source_consistency';
    source_version?: string;
    explanation_version?: string;
    /**
     * 总结（可选）
     */
    summary?: (string | null);
};
