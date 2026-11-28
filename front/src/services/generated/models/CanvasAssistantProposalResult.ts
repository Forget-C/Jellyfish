/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantEditConflict } from './CanvasAssistantEditConflict';
import type { CanvasAssistantGenerationRead } from './CanvasAssistantGenerationRead';
import type { CanvasAssistantIndependentReview } from './CanvasAssistantIndependentReview';
import type { CanvasAssistantProposal } from './CanvasAssistantProposal';
import type { CanvasRead } from './CanvasRead';
import type { CanvasSaved } from './CanvasSaved';
/**
 * Approval status and the canonical canvas after a successful save.
 */
export type CanvasAssistantProposalResult = {
    proposal: CanvasAssistantProposal;
    receipt?: (CanvasSaved | null);
    canvas?: (CanvasRead | null);
    conflicts?: Array<CanvasAssistantEditConflict>;
    generation?: (CanvasAssistantGenerationRead | null);
    automatic_review?: (CanvasAssistantIndependentReview | null);
    graph_resumed?: boolean;
};
