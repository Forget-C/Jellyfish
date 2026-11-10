/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardConflictChoice } from './StoryboardConflictChoice';
/**
 * Bind conflict selection to the compared design and adoption plan.
 */
export type StoryboardContinuityDiff = {
    token: string;
    stale?: boolean;
    can_review_plan?: boolean;
    conflicts?: Array<StoryboardConflictChoice>;
};
