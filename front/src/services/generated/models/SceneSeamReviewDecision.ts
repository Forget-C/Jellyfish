/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 人工观察与成立内容、待处理问题固定保存，不替代整场验收。
 */
export type SceneSeamReviewDecision = {
    verdict: 'pass' | 'revise';
    observation: string;
    established?: string;
    issues?: string;
};
