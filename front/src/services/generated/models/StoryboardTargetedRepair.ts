/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Explicitly request a new attempt for one reviewed conflict.
 */
export type StoryboardTargetedRepair = {
    conflict_id: string;
    expected_revision: number;
    review_token: string;
    overwrite_card_ids?: Array<string>;
};
