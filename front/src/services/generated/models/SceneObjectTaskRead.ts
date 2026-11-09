/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskStatus } from './TaskStatus';
/**
 * 只公开任务状态和已清理的错误。
 */
export type SceneObjectTaskRead = {
    task_id: string;
    status: TaskStatus;
    stage: string;
    error?: (string | null);
};
