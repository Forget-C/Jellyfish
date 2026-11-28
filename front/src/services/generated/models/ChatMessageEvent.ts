/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantExchange } from './CanvasAssistantExchange';
import type { ReplyUpdate } from './ReplyUpdate';
export type ChatMessageEvent = {
    session_id: string;
    turn_id: (string | null);
    cursor: number;
    type: string;
    payload: ReplyUpdate;
    occurred_at?: (string | null);
    target_version?: (string | null);
    group_ids?: (Array<string> | null);
    subject?: (string | null);
    category: 'message';
    detail?: (CanvasAssistantExchange | null);
};
