/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantAttachment } from './CanvasAssistantAttachment';
import type { CanvasAssistantReadContext } from './CanvasAssistantReadContext';
import type { CanvasAssistantSkillUse } from './CanvasAssistantSkillUse';
/**
 * A completed turn in the order visible to the user.
 */
export type CanvasAssistantExchange = {
    request_id: string;
    text: string;
    context?: (CanvasAssistantReadContext | null);
    attachments?: (Array<CanvasAssistantAttachment> | null);
    sequence: number;
    model_id: string;
    reply: string;
    skills?: (Array<CanvasAssistantSkillUse> | null);
};
