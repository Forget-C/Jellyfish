/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneSeamReviewDecision } from './SceneSeamReviewDecision';
/**
 * 按原保存修订与片段身份提交；不按 Take 名称或最近结果重绑。
 */
export type SceneSeamReviewCreate = {
    request_id: string;
    expected_revision: number;
    left_clip_id: string;
    right_clip_id: string;
    decision: SceneSeamReviewDecision;
};
