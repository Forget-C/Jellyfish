/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantApprovalAudit } from './CanvasAssistantApprovalAudit';
import type { CanvasAssistantAttachment } from './CanvasAssistantAttachment';
import type { CanvasAssistantCardReference } from './CanvasAssistantCardReference';
import type { CanvasAssistantFieldRevision } from './CanvasAssistantFieldRevision';
import type { CanvasAssistantGenerationRead } from './CanvasAssistantGenerationRead';
import type { CanvasAssistantInstruction } from './CanvasAssistantInstruction';
import type { CanvasAssistantLayout } from './CanvasAssistantLayout';
import type { CanvasAssistantProgress } from './CanvasAssistantProgress';
import type { CanvasAssistantProposal } from './CanvasAssistantProposal';
import type { CanvasAssistantProposalIssue } from './CanvasAssistantProposalIssue';
import type { CanvasAssistantQuestion } from './CanvasAssistantQuestion';
import type { CanvasAssistantQuestionAnswer } from './CanvasAssistantQuestionAnswer';
import type { CanvasAssistantReadContext } from './CanvasAssistantReadContext';
import type { CanvasAssistantReadOnlyPreview } from './CanvasAssistantReadOnlyPreview';
import type { CanvasAssistantSkillUse } from './CanvasAssistantSkillUse';
import type { CanvasAssistantSubtask } from './CanvasAssistantSubtask';
import type { ChatToolCall } from './ChatToolCall';
/**
 * A completed turn in the order visible to the user.
 */
export type CanvasAssistantExchange = {
    request_id: string;
    text: string;
    context?: (CanvasAssistantReadContext | null);
    attachments?: (Array<CanvasAssistantAttachment> | null);
    canvas_references?: (Array<CanvasAssistantCardReference> | null);
    sequence: number;
    model_id: string;
    reply: string;
    proposal?: (CanvasAssistantProposal | null);
    preview?: (CanvasAssistantReadOnlyPreview | null);
    submitted_preview_id?: (string | null);
    proposal_issues?: (Array<CanvasAssistantProposalIssue> | null);
    revises?: (string | null);
    revises_field?: (CanvasAssistantFieldRevision | null);
    repairs?: (string | null);
    skills?: (Array<CanvasAssistantSkillUse> | null);
    subtasks?: (Array<CanvasAssistantSubtask> | null);
    automatic_approval?: boolean;
    approval_audit?: (Array<CanvasAssistantApprovalAudit> | null);
    generation?: (CanvasAssistantGenerationRead | null);
    stopped?: boolean;
    tool_calls?: Array<ChatToolCall>;
    progress?: (CanvasAssistantProgress | null);
    error_code?: (string | null);
    layout?: (CanvasAssistantLayout | null);
    question?: (CanvasAssistantQuestion | null);
    question_answers?: (Array<CanvasAssistantQuestionAnswer> | null);
    instructions?: (Array<CanvasAssistantInstruction> | null);
};
