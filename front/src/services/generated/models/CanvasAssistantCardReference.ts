/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantGroupReference } from './CanvasAssistantGroupReference';
/**
 * Explicit read-only reference to cards in another saved canvas.
 */
export type CanvasAssistantCardReference = {
    canvas_id: string;
    card_ids: Array<string>;
    groups?: Array<CanvasAssistantGroupReference>;
};
