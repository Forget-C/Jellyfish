/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskStatus } from './TaskStatus';
/**
 * 列表只需任务身份与真实状态，不携带输入、候选或执行详情。
 */
export type WorkbenchTaskSummary = {
    task_id: string;
    status: TaskStatus;
};
