/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Audit details from the independently prompted approval model.
 */
export type CanvasAssistantIndependentReview = {
    status: 'approved' | 'manual_required' | 'unavailable' | 'blocked';
    reviewer_model_id?: (string | null);
    policy?: string;
    reason: string;
};
