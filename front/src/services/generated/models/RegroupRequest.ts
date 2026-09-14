/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 在已确认计划上明确拆分或组合单元，结果只能是新计划草稿。
 */
export type RegroupRequest = {
    plan_revision_id: string;
    unit_ids: Array<string>;
    operation: 'split' | 'merge';
};
