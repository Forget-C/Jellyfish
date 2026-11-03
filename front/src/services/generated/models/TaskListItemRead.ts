/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskSourceRead } from './TaskSourceRead';
import type { TaskStatus } from './TaskStatus';
/**
 * 任务中心只展示通用任务信息及唯一来源。
 */
export type TaskListItemRead = {
    task_id: string;
    status: TaskStatus;
    stage: string;
    progress?: (number | null);
    cancel_requested?: boolean;
    cancel_requested_at_ts?: (number | null);
    started_at_ts?: (number | null);
    finished_at_ts?: (number | null);
    elapsed_ms?: (number | null);
    source?: (TaskSourceRead | null);
    task_kind: string;
    title: string;
    target_type?: (string | null);
    target_id?: (string | null);
    project_id?: (string | null);
    created_at_ts: number;
    updated_at_ts: number;
};
