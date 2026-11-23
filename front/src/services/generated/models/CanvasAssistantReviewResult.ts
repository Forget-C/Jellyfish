/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantAttachment } from './CanvasAssistantAttachment';
import type { CanvasAssistantSkillUse } from './CanvasAssistantSkillUse';
/**
 * Feedback or an evidence limitation tied to one canonical run.
 */
export type CanvasAssistantReviewResult = {
    run_id: string;
    version: number;
    reply: string;
    evidence?: Array<CanvasAssistantAttachment>;
    skills?: Array<CanvasAssistantSkillUse>;
};
