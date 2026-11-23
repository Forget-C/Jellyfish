/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantQueuedText } from './CanvasAssistantQueuedText';
/**
 * A recoverable queue entry, distinct from its eventual conversation turn.
 */
export type CanvasAssistantQueueItem = {
    request_id: string;
    turn_id?: (string | null);
    state: 'queued' | 'admitted' | 'completed' | 'removed';
    message: CanvasAssistantQueuedText;
};
