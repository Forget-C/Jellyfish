/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvidenceSpan } from './EvidenceSpan';
/**
 * 角色混淆类一致性问题：同一角色在不同镜头被赋予不同身份/行为主体导致混淆。
 */
export type ScriptConsistencyIssue = {
    /**
     * 固定为角色混淆类问题
     */
    issue_type?: string;
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

