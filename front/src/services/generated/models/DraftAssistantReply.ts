/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantExchange } from './CanvasAssistantExchange';
/**
 * Short-lived reply snapshot while the transcript belongs to the browser.
 */
export type DraftAssistantReply = {
    state: 'running' | 'completed' | 'stopped' | 'interrupted';
    turn: CanvasAssistantExchange;
};
