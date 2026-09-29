/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReviewDirection } from './ReviewDirection';
import type { RevisionEdit } from './RevisionEdit';
/**
 * 采用必须回传当前方向和固定身份，不能仅依赖前端禁用按钮。
 */
export type ApplyReviewRevisionRequest = {
    task_id: string;
    instruction?: string;
    edits?: Array<RevisionEdit>;
    candidate_identity?: (string | null);
    input_identity: string;
    directions?: Array<ReviewDirection>;
    request_id: string;
};
