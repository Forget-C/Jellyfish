/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneCutReviewDecision } from './SceneCutReviewDecision';
import type { SceneVersionContent_Output } from './SceneVersionContent_Output';
/**
 * 固定人工结论及完整内容，当前适用性只读计算。
 */
export type SceneCutReviewRead = {
    id: string;
    version_id: string;
    request_id: string;
    revision: number;
    decision: SceneCutReviewDecision;
    content: SceneVersionContent_Output;
    created_at: string;
    matches_current: boolean;
};
