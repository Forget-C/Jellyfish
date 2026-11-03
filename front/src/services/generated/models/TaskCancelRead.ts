/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskStatus } from './TaskStatus';
/**
 * 取消结果直接反映服务裁决后的任务状态。
 */
export type TaskCancelRead = {
    task_id: string;
    status: TaskStatus;
    cancel_requested: boolean;
    cancel_requested_at_ts?: (number | null);
    effective_immediately?: boolean;
};
