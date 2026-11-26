/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LabChatSnapshot } from './LabChatSnapshot';
/**
 * Common history checkpoint returned when opening a typed chat session.
 */
export type ChatSessionSnapshot = {
    session_id: string;
    cursor: number;
    capabilities: Array<string>;
    kind: string;
    history: LabChatSnapshot;
};

