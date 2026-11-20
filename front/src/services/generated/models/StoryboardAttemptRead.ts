/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * One task's outcome; it does not describe unresolved draft validation issues.
 */
export type StoryboardAttemptRead = {
    task_id: string;
    created_at: string;
    status: string;
    title: string;
    reason: string;
    correction_notes?: string;
    diagnostics?: Array<string>;
};
