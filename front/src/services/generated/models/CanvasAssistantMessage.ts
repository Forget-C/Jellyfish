/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantDraftContext } from './CanvasAssistantDraftContext';
/**
 * Send a turn with a stable request identity for retries.
 */
export type CanvasAssistantMessage = {
    request_id: string;
    text: string;
    context?: (CanvasAssistantDraftContext | null);
    attachment_file_ids?: Array<string>;
};
