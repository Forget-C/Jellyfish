/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantApprovalAudit } from './CanvasAssistantApprovalAudit';
import type { CanvasAssistantAttachment } from './CanvasAssistantAttachment';
import type { CanvasAssistantGenerationRead } from './CanvasAssistantGenerationRead';
import type { CanvasAssistantProposal } from './CanvasAssistantProposal';
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
    proposal?: (CanvasAssistantProposal | null);
    revises?: (string | null);
    skills?: (Array<CanvasAssistantSkillUse> | null);
    automatic_approval?: boolean;
    approval_audit?: (Array<CanvasAssistantApprovalAudit> | null);
    generation?: (CanvasAssistantGenerationRead | null);
};
