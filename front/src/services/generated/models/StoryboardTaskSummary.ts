/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskStatus } from './TaskStatus';
/**
 * 轻量任务状态，用于离开后恢复查看。
 */
export type StoryboardTaskSummary = {
    task_id: string;
    status: TaskStatus;
    stage: string;
    error?: (string | null);
    canvas_id: string;
    candidate_available?: boolean;
    retry_of_task_id?: (string | null);
};
