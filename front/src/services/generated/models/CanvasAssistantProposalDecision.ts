/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Decide on a stored proposal at the editor's current saved revision.
 */
export type CanvasAssistantProposalDecision = {
    action: 'approve' | 'reject';
    expected_revision: number;
    decision_id?: (string | null);
    group_ids?: (Array<string> | null);
    approval_mode?: 'manual' | 'automatic';
    approve_layout?: boolean;
};
