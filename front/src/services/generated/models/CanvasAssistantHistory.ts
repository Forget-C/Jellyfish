/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantExchange } from './CanvasAssistantExchange';
import type { CanvasAssistantInstruction } from './CanvasAssistantInstruction';
import type { CanvasAssistantPendingRequest } from './CanvasAssistantPendingRequest';
import type { CanvasAssistantQuestion } from './CanvasAssistantQuestion';
import type { CanvasAssistantQueueItem } from './CanvasAssistantQueueItem';
/**
 * Persisted exchanges for the selected canvas.
 */
export type CanvasAssistantHistory = {
    session_id: string;
    cursor: number;
    capabilities: Array<'snapshot' | 'send' | 'events' | 'stop' | 'approval' | 'question' | 'queue' | 'steer'>;
    turns: Array<CanvasAssistantExchange>;
    pending_request?: (CanvasAssistantPendingRequest | null);
    pending_question?: (CanvasAssistantQuestion | null);
    pending_instructions?: Array<CanvasAssistantInstruction>;
    queue?: Array<CanvasAssistantQueueItem>;
    model_id?: (string | null);
    approval_mode?: 'manual' | 'automatic';
};
