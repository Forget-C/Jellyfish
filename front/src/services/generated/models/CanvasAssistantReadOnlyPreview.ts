/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantProposal } from './CanvasAssistantProposal';
/**
 * The exact candidate displayed before the user sends it for approval.
 */
export type CanvasAssistantReadOnlyPreview = {
    id: string;
    revision: number;
    proposal: CanvasAssistantProposal;
};
