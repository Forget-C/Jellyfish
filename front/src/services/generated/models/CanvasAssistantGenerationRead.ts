/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantGenerationVersion } from './CanvasAssistantGenerationVersion';
/**
 * Generation proceeds independently of the composing assistant model.
 */
export type CanvasAssistantGenerationRead = {
    card_id: string;
    requested_count: number;
    state: 'waiting_approval' | 'queued' | 'running' | 'completed' | 'failed' | 'rejected';
    error?: (string | null);
    versions?: Array<CanvasAssistantGenerationVersion>;
};
