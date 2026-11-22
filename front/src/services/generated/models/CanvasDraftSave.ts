/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DraftAssistantApproval } from './DraftAssistantApproval';
import type { DraftAssistantConversation } from './DraftAssistantConversation';
/**
 * Include the local conversation in the ordinary idempotent first save.
 */
export type CanvasDraftSave = {
    request_id: string;
    expected_revision: number;
    document: any;
    assistant?: (DraftAssistantConversation | null);
    assistant_approval?: (DraftAssistantApproval | null);
};
