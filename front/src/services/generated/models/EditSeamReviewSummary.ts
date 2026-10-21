/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 当前相关固定审查身份和结论；完整历史由原记录入口读取。
 */
export type EditSeamReviewSummary = {
    id: string;
    version_id: string;
    revision: number;
    verdict: 'pass' | 'revise';
    observation: string;
    established: string;
    issues: string;
};
