/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantDraftContext } from './CanvasAssistantDraftContext';
import type { CanvasAssistantFieldRevision } from './CanvasAssistantFieldRevision';
/**
 * Reply without storing a conversation or requiring a saved canvas.
 */
export type DraftAssistantMessage = {
    /**
     * 此前返回的有序 CanvasAssistantExchange 对象
     */
    turns?: Array<Record<string, any>>;
    model_id?: (string | null);
    request_id: string;
    text: string;
    context?: (CanvasAssistantDraftContext | null);
    revises?: (string | null);
    revises_field?: (CanvasAssistantFieldRevision | null);
    attachment_file_ids?: Array<string>;
};
