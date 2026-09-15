/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 逐个计划单元展示依赖失效原因，不自动启动补拍。
 */
export type UnitContinuityRead = {
    plan_revision_id: string;
    unit_id: string;
    status: 'ready' | 'blocked';
    errors: Array<string>;
};
