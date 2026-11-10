/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Explicitly request a new attempt for one reviewed conflict.
 */
export type StoryboardTargetedRepair = {
    expected_revision: number;
    overwrite_card_ids?: Array<string>;
    conflict_id: string;
    review_token: string;
};
