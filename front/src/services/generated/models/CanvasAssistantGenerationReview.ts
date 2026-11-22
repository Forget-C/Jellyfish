/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantReviewResult } from './CanvasAssistantReviewResult';
/**
 * Lifecycle of the follow-up authorized by the originating user message.
 */
export type CanvasAssistantGenerationReview = {
    state: 'waiting' | 'reviewing' | 'completed' | 'stopped';
    results?: Array<CanvasAssistantReviewResult>;
};
