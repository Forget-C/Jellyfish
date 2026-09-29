/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReviewDirection } from './ReviewDirection';
import type { RevisionEdit } from './RevisionEdit';
import type { RevisionReviewSource } from './RevisionReviewSource';
/**
 * 冻结整体要求、字段编辑和可选检查；请求身份用于恢复响应丢失的任务。
 */
export type ReviewRevisionRequest = {
    prompt_revision_id: string;
    review_source?: (RevisionReviewSource | null);
    instruction?: string;
    edits?: Array<RevisionEdit>;
    directions?: Array<ReviewDirection>;
    model_id?: (string | null);
    request_id: string;
};
