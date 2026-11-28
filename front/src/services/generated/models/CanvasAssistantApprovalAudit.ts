/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantEditConflict } from './CanvasAssistantEditConflict';
import type { CanvasAssistantIndependentReview } from './CanvasAssistantIndependentReview';
/**
 * A decision associated with the message on which it was taken.
 */
export type CanvasAssistantApprovalAudit = {
    source_id: string;
    mode: 'manual' | 'automatic';
    action: 'approve' | 'reject';
    outcome: 'approved' | 'applied' | 'rejected' | 'partial' | 'conflict' | 'failed' | 'blocked' | 'manual_required';
    conflicts?: (Array<CanvasAssistantEditConflict> | null);
    review?: (CanvasAssistantIndependentReview | null);
    group_ids?: (Array<string> | null);
    decision_id?: (string | null);
};
