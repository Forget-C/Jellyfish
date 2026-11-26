/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantExchange } from './CanvasAssistantExchange';
import type { ToolUpdate } from './ToolUpdate';
export type ChatToolEvent = {
    session_id: string;
    turn_id: (string | null);
    cursor: number;
    type: 'tool.started' | 'tool.completed' | 'tool.failed';
    payload: ToolUpdate;
    occurred_at?: (string | null);
    target_version?: (string | null);
    group_ids?: (Array<string> | null);
    subject?: (string | null);
    category: 'tool';
    detail?: (CanvasAssistantExchange | null);
};
