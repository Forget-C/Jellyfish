/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 用户明确指定本次局部覆盖和时长，生成草稿而非付费请求。
 */
export type RepairPlanRequest = {
    coverage_item_ids: Array<string>;
    action_scope: string;
    duration_ms: number;
};
