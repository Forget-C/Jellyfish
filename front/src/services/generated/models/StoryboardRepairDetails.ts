/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardRepairChange } from './StoryboardRepairChange';
import type { StoryboardReviewReport } from './StoryboardReviewReport';
/**
 * An attempt is not evidence that a repair or its recheck succeeded.
 */
export type StoryboardRepairDetails = {
    status: 'attempted' | 'applied' | 'no_change' | 'rejected' | 'unavailable';
    reason?: string;
    before_review: StoryboardReviewReport;
    changes?: Array<StoryboardRepairChange>;
};
