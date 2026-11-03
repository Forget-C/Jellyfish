/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ScriptConsistencyIssue } from './ScriptConsistencyIssue';
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
    /**
     * 总结（可选）
     */
    summary?: (string | null);
};

