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
    group_ids?: (Array<string> | null);
};
