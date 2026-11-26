/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantHistory } from './CanvasAssistantHistory';
import type { LabChatSnapshot } from './LabChatSnapshot';
import type { TrialChatHistory } from './TrialChatHistory';
/**
 * Common history checkpoint returned when opening a typed chat session.
 */
export type ChatSessionSnapshot = {
    session_id: string;
    cursor: number;
    capabilities: Array<string>;
    kind: 'canvas' | 'chat' | 'text' | 'image' | 'video';
    history: (CanvasAssistantHistory | LabChatSnapshot | TrialChatHistory);
};

