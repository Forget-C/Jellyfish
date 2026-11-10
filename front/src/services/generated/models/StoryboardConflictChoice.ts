/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardReviewIssue } from './StoryboardReviewIssue';
/**
 * A specific conflict and any applicable prior decision.
 */
export type StoryboardConflictChoice = {
    id: string;
    issue: StoryboardReviewIssue;
    previously_accepted?: boolean;
    can_repair?: boolean;
};
