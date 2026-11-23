/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantDraftContext } from './CanvasAssistantDraftContext';
import type { CanvasAssistantFieldRevision } from './CanvasAssistantFieldRevision';
/**
 * Send a turn with a stable request identity for retries.
 */
export type CanvasAssistantMessage = {
    request_id: string;
    text: string;
    context?: (CanvasAssistantDraftContext | null);
    revises?: (string | null);
    revises_field?: (CanvasAssistantFieldRevision | null);
    attachment_file_ids?: Array<string>;
};
