/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskStatus } from './TaskStatus';
export type TaskResultRead = {
    task_id: string;
    status: TaskStatus;
    progress: number;
    result?: (Record<string, any> | null);
    error?: string;
};

