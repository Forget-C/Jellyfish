/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardRepairTarget } from './StoryboardRepairTarget';
/**
 * Semantic findings cite existing draft shots and give a concrete remedy.
 */
export type StoryboardReviewIssue = {
    kind: 'conflict' | 'insufficient_basis';
    shot_ids: Array<string>;
    requirements: string;
    suggestion: string;
    prompt_unit_ids?: Array<string>;
    repair_targets?: Array<StoryboardRepairTarget>;
};
