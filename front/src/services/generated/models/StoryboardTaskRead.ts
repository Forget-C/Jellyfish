/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardCandidate } from './StoryboardCandidate';
import type { TaskStatus } from './TaskStatus';
/**
 * 真实任务状态及成功后可读取的候选。
 */
export type StoryboardTaskRead = {
    task_id: string;
    status: TaskStatus;
    stage: string;
    error?: (string | null);
    canvas_id: string;
    candidate_available?: boolean;
    retry_of_task_id?: (string | null);
    pending_application?: boolean;
    candidate?: (StoryboardCandidate | null);
};
