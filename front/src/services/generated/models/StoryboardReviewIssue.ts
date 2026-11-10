/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Semantic findings cite existing draft shots and give a concrete remedy.
 */
export type StoryboardReviewIssue = {
    kind: 'conflict' | 'insufficient_basis';
    shot_ids: Array<string>;
    requirements: string;
    suggestion: string;
};
