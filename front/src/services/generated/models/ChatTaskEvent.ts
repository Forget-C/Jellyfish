/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskUpdate } from './TaskUpdate';
export type ChatTaskEvent = {
    session_id: string;
    turn_id: (string | null);
    cursor: number;
    type: 'task.accepted' | 'task.progress' | 'task.completed' | 'task.cancelled' | 'task.failed' | 'artifact.created';
    payload: TaskUpdate;
    occurred_at?: (string | null);
    target_version?: (string | null);
    group_ids?: (Array<string> | null);
    subject?: (string | null);
    category: 'task';
    detail?: null;
};
