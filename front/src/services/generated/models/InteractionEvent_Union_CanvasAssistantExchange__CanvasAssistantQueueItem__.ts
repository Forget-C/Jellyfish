/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantExchange } from './CanvasAssistantExchange';
import type { CanvasAssistantQueueItem } from './CanvasAssistantQueueItem';
export type InteractionEvent_Union_CanvasAssistantExchange__CanvasAssistantQueueItem__ = {
    session_id: string;
    turn_id: (string | null);
    cursor: number;
    type: string;
    payload: (CanvasAssistantExchange | CanvasAssistantQueueItem);
    occurred_at?: (string | null);
    target_version?: (string | null);
    group_ids?: (Array<string> | null);
    subject?: (string | null);
};
