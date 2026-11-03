/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单字段候选及来源；明确事实必须提供可核对的原文证据。
 */
export type AssetFieldSuggestion = {
    field: string;
    value: string;
    source: 'explicit' | 'inferred';
    /**
     * explicit 时必须为输入原文片段
     */
    evidence?: string;
};
