/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 当前实际相邻接缝与可复用的最近人工审查。
 */
export type SeamRead = {
    left_item_id: string;
    right_item_id: string;
    status: 'pending' | 'pass' | 'revise';
    review_id?: (string | null);
    rationale?: (string | null);
    reviewed_at?: (string | null);
};
