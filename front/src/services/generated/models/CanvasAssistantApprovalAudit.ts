/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * A decision associated with the message on which it was taken.
 */
export type CanvasAssistantApprovalAudit = {
    source_id: string;
    mode: 'manual' | 'automatic';
    action: 'approve' | 'reject';
    outcome: 'applied' | 'rejected' | 'partial' | 'conflict';
    group_ids?: (Array<string> | null);
};
