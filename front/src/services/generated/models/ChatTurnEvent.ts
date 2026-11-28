/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantExchange } from './CanvasAssistantExchange';
import type { TurnUpdate } from './TurnUpdate';
export type ChatTurnEvent = {
    session_id: string;
    turn_id: (string | null);
    cursor: number;
    type: 'turn.accepted' | 'turn.completed' | 'turn.failed' | 'turn.stopped';
    payload: TurnUpdate;
    occurred_at?: (string | null);
    target_version?: (string | null);
    group_ids?: (Array<string> | null);
    subject?: (string | null);
    category: 'turn';
    detail?: (CanvasAssistantExchange | null);
};
