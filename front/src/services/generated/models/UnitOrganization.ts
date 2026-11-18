/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 当前可编辑组织要求；source 记录人工建立或原 AI 依据，不声明人工改写来自模型。
 */
export type UnitOrganization = {
    reason: string;
    entry_state: string;
    exit_state: string;
    reference_requirements: Array<string>;
    missing: Array<string>;
    source: Source;
};
