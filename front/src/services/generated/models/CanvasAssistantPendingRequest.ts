/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantDraftContext } from './CanvasAssistantDraftContext';
/**
 * Original immutable command available to retry after reconnecting.
 */
export type CanvasAssistantPendingRequest = {
    request_id: string;
    text: string;
    context?: (CanvasAssistantDraftContext | null);
    revises?: (string | null);
    attachment_file_ids?: Array<string>;
};
