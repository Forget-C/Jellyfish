/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskStatus } from './TaskStatus';
/**
 * 任务主表的轻量运行视图。
 */
export type TaskStatusRead = {
    task_id: string;
    status: TaskStatus;
    stage: string;
    progress?: (number | null);
    cancel_requested?: boolean;
    remote_cancellation?: ('requested' | 'unsupported' | 'accepted' | 'confirmed' | 'rejected' | 'unconfirmed' | null);
    cancel_requested_at_ts?: (number | null);
    started_at_ts?: (number | null);
    finished_at_ts?: (number | null);
    elapsed_ms?: (number | null);
};
