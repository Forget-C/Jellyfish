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
    turns: Array<CanvasAssistantExchange>;
    pending_request?: (CanvasAssistantPendingRequest | null);
    model_id?: (string | null);
    approval_mode?: 'manual' | 'automatic';
};
