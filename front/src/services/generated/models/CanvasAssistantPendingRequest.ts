/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantCardReference } from './CanvasAssistantCardReference';
import type { CanvasAssistantDraftContext } from './CanvasAssistantDraftContext';
import type { CanvasAssistantFieldRevision } from './CanvasAssistantFieldRevision';
/**
 * Original immutable command available to retry after reconnecting.
 */
export type CanvasAssistantPendingRequest = {
    request_id: string;
    text: string;
    stream_reply?: boolean;
    context?: (CanvasAssistantDraftContext | null);
    revises?: (string | null);
    revises_field?: (CanvasAssistantFieldRevision | null);
    canvas_references?: Array<CanvasAssistantCardReference>;
    attachment_file_ids?: Array<string>;
};
