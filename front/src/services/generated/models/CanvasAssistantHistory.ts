/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantExchange } from './CanvasAssistantExchange';
import type { CanvasAssistantPendingRequest } from './CanvasAssistantPendingRequest';
/**
 * Persisted exchanges for the selected canvas.
 */
export type CanvasAssistantHistory = {
    session_id: string;
    cursor: number;
    capabilities: Array<'snapshot' | 'send' | 'events' | 'stop' | 'approval'>;
    turns: Array<CanvasAssistantExchange>;
    pending_request?: (CanvasAssistantPendingRequest | null);
    model_id?: (string | null);
    approval_mode?: 'manual' | 'automatic';
};
