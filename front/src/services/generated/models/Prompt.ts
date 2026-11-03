/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CompilationDecision } from './CompilationDecision';
import type { Source } from './Source';
/**
 * 精确绑定生产计划与单元的执行文本快照。
 */
export type Prompt = {
    plan_revision_id: string;
    unit_id: string;
    format_version: string;
    text: string;
    decisions: Array<CompilationDecision>;
    sources: Array<Source>;
};

