/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneCutReviewDecision } from './SceneCutReviewDecision';
/**
 * 明确审查指定已保存修订；请求身份用于未知响应后核实同一次操作。
 */
export type SceneCutReviewCreate = {
    request_id: string;
    expected_revision: number;
    decision: SceneCutReviewDecision;
};
