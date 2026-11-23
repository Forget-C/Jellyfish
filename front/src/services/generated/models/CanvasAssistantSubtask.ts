/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantAttachment } from './CanvasAssistantAttachment';
import type { CanvasAssistantSkillUse } from './CanvasAssistantSkillUse';
/**
 * A read-only specialist result with its actual scope and evidence.
 */
export type CanvasAssistantSubtask = {
    id: string;
    role: 'storyboard-design' | 'footage-continuity-review';
    task: string;
    card_ids: Array<string>;
    model_id: string;
    status: 'completed' | 'failed' | 'blocked';
    skills: Array<CanvasAssistantSkillUse>;
    evidence: Array<CanvasAssistantAttachment>;
    result: string;
};
