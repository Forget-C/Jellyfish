/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneSeamReviewDecision } from './SceneSeamReviewDecision';
import type { SceneVersionContent_Output } from './SceneVersionContent_Output';
/**
 * 保留当时完整内容，适用性只比较该真实接缝及输出构图。
 */
export type SceneSeamReviewRead = {
    id: string;
    version_id: string;
    request_id: string;
    revision: number;
    left_clip_id: string;
    right_clip_id: string;
    decision: SceneSeamReviewDecision;
    content: SceneVersionContent_Output;
    created_at: string;
    matches_current: boolean;
};
