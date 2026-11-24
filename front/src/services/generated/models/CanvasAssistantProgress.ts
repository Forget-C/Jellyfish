/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantAttachment } from './CanvasAssistantAttachment';
import type { CanvasAssistantSkillUse } from './CanvasAssistantSkillUse';
import type { CanvasAssistantSubtask } from './CanvasAssistantSubtask';
/**
 * Evidence available while the leased turn is still running.
 */
export type CanvasAssistantProgress = {
    reply?: (string | null);
    streaming?: (boolean | null);
    error_code?: (string | null);
    phase?: ('waiting_model' | 'reasoning' | 'generating_proposal' | 'validating_proposal' | null);
    phase_started_at?: Record<string, string>;
    request_id: string;
    scope?: ('selection' | 'canvas' | null);
    revision?: (number | null);
    target_card_ids?: Array<string>;
    observed_card_ids?: Array<string>;
    model_id: string;
    skills?: Array<CanvasAssistantSkillUse>;
    attachments?: Array<CanvasAssistantAttachment>;
    active_tasks?: Record<string, string>;
    subtasks?: Array<CanvasAssistantSubtask>;
};
