/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 人工查看相邻真实片段后，对明确的两张边界帧作出结论。
 */
export type SeamReviewRequest = {
    cut_revision_id: string;
    left_frame_id: string;
    right_frame_id: string;
    verdict: 'pass' | 'revise';
    rationale: string;
};
