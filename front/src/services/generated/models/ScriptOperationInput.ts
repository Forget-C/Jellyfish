/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 剧本 Agent 的强类型入口基类，保留 operation 而不是退化为任意字典。
 */
export type ScriptOperationInput = {
    kind?: string;
    operation: 'check-consistency' | 'analyze-character-portrait' | 'analyze-prop-info' | 'analyze-scene-info' | 'analyze-costume-info' | 'optimize-script' | 'simplify-script';
    source_text: string;
};
